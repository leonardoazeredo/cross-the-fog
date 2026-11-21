import { PAGE_MESSAGES } from "../src/bridge/messages.js";
import type { ExportChunk, NativeToWeb, RouteRecord } from "../src/bridge/protocol.js";
import type { Send } from "./bridge.js";

type PageEvent = keyof typeof PAGE_MESSAGES;
type PageMessage<E extends PageEvent> = Extract<NativeToWeb, { type: E }>;

// The one list of native-to-page events: the keys of the page half of the message table. The listener table,
// `isPageMessage` and the session's routing all follow it, and the session's handlers are the other half.
const PAGE_EVENTS = Object.keys(PAGE_MESSAGES) as PageEvent[];

// True for a message the page API delivers to `window.crossfog.on` listeners.
export function isPageMessage(msg: NativeToWeb): msg is PageMessage<PageEvent> {
  return Object.hasOwn(PAGE_MESSAGES, msg.type);
}

// The page never sees the bridge envelope (`v`, `type`), only the payload.
type PageListener<E extends PageEvent> = (payload: Omit<PageMessage<E>, "v" | "type">) => void;

interface CrossfogApi {
  sendRoute(route: RouteRecord): void;
  needTrack(activityId: string): void;
  deleteActivity(activityId: string): void;
  exportBinary(chunk: ExportChunk): void;
  backup(): void;
  restore(): void;
  on<E extends PageEvent>(event: E, fn: PageListener<E>): () => void;
}

declare global {
  interface Window {
    crossfog?: CrossfogApi;
  }
}

export interface PageApi {
  dispatch(msg: NativeToWeb): void;
}

export function installPageApi(win: Window, send: Send): PageApi {
  // One set per event, each holding listeners of that event's payload, so `on` and `emit` need no cast.
  type Entry<E extends PageEvent> = { fn: PageListener<E> };
  type Listeners = { [E in PageEvent]: Set<Entry<E>> };
  // `Object.fromEntries` types its values as one type for every key; the keys are exactly PAGE_EVENTS.
  const listeners = Object.fromEntries(PAGE_EVENTS.map((e) => [e, new Set()])) as Listeners;

  function on<E extends PageEvent>(event: E, fn: PageListener<E>): () => void {
    const entry: Entry<E> = { fn };
    listeners[event].add(entry);
    return () => {
      listeners[event].delete(entry);
    };
  }

  win.crossfog = {
    sendRoute: (route) => send({ v: 1, type: "sendRoute", route }),
    needTrack: (activityId) => send({ v: 1, type: "needTrack", activityId }),
    deleteActivity: (activityId) => send({ v: 1, type: "deleteActivity", activityId }),
    exportBinary: (chunk) => send({ ...chunk, v: 1, type: "exportBinary" }),
    backup: () => send({ v: 1, type: "backup" }),
    restore: () => send({ v: 1, type: "restore" }),
    on,
  };

  function emit<E extends PageEvent>(event: E, payload: Omit<PageMessage<E>, "v" | "type">): void {
    // Iterate a copy: a listener added during dispatch must not receive this message, and one that
    // re-subscribes on every call must not loop.
    for (const { fn } of [...listeners[event]]) {
      try {
        fn(payload);
      } catch (err) {
        // A throwing listener must not stop the others or reach the caller of dispatch. Only the event
        // name is logged: the payload carries positions, which must not reach logs.
        console.error(
          `crossfog: a ${event} listener threw ${err instanceof Error ? err.name : typeof err}`,
        );
      }
    }
  }

  return {
    dispatch(msg) {
      if (!isPageMessage(msg)) return;
      const { v: _v, type, ...payload } = msg;
      emit(type, payload);
    },
  };
}
