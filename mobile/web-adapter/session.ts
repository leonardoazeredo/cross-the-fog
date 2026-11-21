import { type Handlers, handlerFor } from "../src/bridge/handlers.js";
import type { SESSION_MESSAGES } from "../src/bridge/messages.js";
import type { NativeToWeb, WebToNative } from "../src/bridge/protocol.js";
import type { Send } from "./bridge.js";
import type { FogCache } from "./fogCache.js";
import type { LoadOutcome } from "./loader.js";
import { isPageMessage, type PageApi } from "./pageApi.js";
import { createReceiver } from "./receive.js";
import type { PageSettings } from "./settings.js";
import type { Status, StatusActions } from "./status.js";

export type { StatusActions };

export interface SessionDeps {
  send: Send;
  cache: FogCache;
  status: Status;
  load(bytes: Uint8Array, name: string): Promise<LoadOutcome>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  handleBack(): boolean;
  pageApi: PageApi;
  settings: PageSettings;
}

export function createStatusActions(send: Send): StatusActions {
  return {
    update: () => send({ v: 1, type: "pickBackup" }),
    clear: () => send({ v: 1, type: "clearSavedFog" }),
    about: () => send({ v: 1, type: "openAbout" }),
    retry: () => send({ v: 1, type: "retryReload" }),
  };
}

export function createSession(deps: SessionDeps): { onMessage(msg: NativeToWeb): Promise<void> } {
  const { send, cache, status, load, sha256Hex, handleBack, pageApi, settings } = deps;

  type ActiveCopy = {
    fingerprint: string;
    name: string;
    savedAt: string;
    size: number;
    role: "current" | "pending";
    receiver: ReturnType<typeof createReceiver>;
    mismatches: number;
    transferred: boolean;
  };

  let active: ActiveCopy | null = null;

  async function afterLoad(
    outcome: LoadOutcome,
    meta: { fingerprint: string; name: string; savedAt: string; role: "current" | "pending" },
    transferred: boolean,
    bytes: Uint8Array,
  ): Promise<void> {
    const loaded: WebToNative = outcome.ok
      ? { v: 1, type: "loaded", fingerprint: meta.fingerprint, ok: true, tiles: outcome.tiles }
      : { v: 1, type: "loaded", fingerprint: meta.fingerprint, ok: false, reason: outcome.reason };
    send(loaded);

    if (outcome.ok) {
      status.showSaved({ name: meta.name, savedAt: meta.savedAt });
      if (transferred) {
        await cache.putOnly(meta.fingerprint, bytes);
      }
    } else if (meta.role === "current") {
      status.showRetry("failed");
    }
  }

  type SessionMessage = Extract<NativeToWeb, { type: keyof typeof SESSION_MESSAGES }>;

  // The messages the session answers itself, checked against the session half of the table: a session type with
  // no handler, or a handler for any other type, does not compile. Every other type is the page API's.
  const handlers = {
    none: async () => {
      await cache.clearAll();
      status.hide();
    },

    reload: async (msg) => {
      const cached = await cache.get(msg.fingerprint);
      if (cached != null) {
        const outcome = await load(cached, msg.name);
        await afterLoad(outcome, msg, false, cached);
      } else {
        active = {
          fingerprint: msg.fingerprint,
          name: msg.name,
          savedAt: msg.savedAt,
          size: msg.size,
          role: msg.role,
          receiver: createReceiver(msg.fingerprint, sha256Hex),
          mismatches: 0,
          transferred: true,
        };
        send({ v: 1, type: "needBytes", fingerprint: msg.fingerprint });
        status.showProgress(0, msg.size);
      }
    },

    chunk: async (msg) => {
      if (active == null || msg.fingerprint !== active.fingerprint) return;
      const result = await active.receiver.accept(msg);
      if (result.kind === "partial") {
        status.showProgress(result.receivedBytes, active.size);
      } else if (result.kind === "complete") {
        const { fingerprint, name, savedAt, role, transferred } = active;
        active = null;
        const outcome = await load(result.bytes, name);
        await afterLoad(outcome, { fingerprint, name, savedAt, role }, transferred, result.bytes);
      } else {
        active.mismatches++;
        if (active.mismatches === 1) {
          send({ v: 1, type: "needBytes", fingerprint: active.fingerprint });
          active.receiver = createReceiver(active.fingerprint, sha256Hex);
        } else {
          const { fingerprint, role } = active;
          active = null;
          const loaded: WebToNative = {
            v: 1,
            type: "loaded",
            fingerprint,
            ok: false,
            reason: "checksum",
          };
          send(loaded);
          if (role === "current") status.showRetry("failed");
        }
      }
    },

    reloadSuspended: () => {
      status.showRetry("suspended");
    },

    notice: (msg) => {
      status.showNotice(msg.text);
    },

    back: () => {
      send({ v: 1, type: "back:result", handled: handleBack() });
    },

    needSettings: () => {
      send({ v: 1, type: "settings", json: settings.collect() });
    },

    applySettings: (msg) => {
      // The phone waits for this answer before it reloads the page, so the saved choices are in place when the page starts again.
      if (settings.apply(msg.json)) send({ v: 1, type: "settingsApplied" });
    },
  } satisfies Handlers<SessionMessage>;

  return {
    async onMessage(msg: NativeToWeb): Promise<void> {
      const handle = handlerFor(handlers, msg);
      if (handle) await handle();
      else if (isPageMessage(msg)) pageApi.dispatch(msg);
    },
  };
}
