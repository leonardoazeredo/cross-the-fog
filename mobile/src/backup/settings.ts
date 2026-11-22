import type { NativeToWeb } from "../bridge/protocol.js";

const KEY_RE = /^f2m_[A-Za-z0-9_]{1,64}$/;

export const isSettingsKey = (key: string): boolean => KEY_RE.test(key);
export const MAX_SETTINGS_BYTES = 16_384;

/** The page's saved choices as `{key: value}`; null when the text is anything else, so nothing foreign reaches localStorage. */
export function parseSettings(json: string): Record<string, string> | null {
  if (json.length > MAX_SETTINGS_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!KEY_RE.test(k) || typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

export interface SettingsChannel {
  /** The page's settings as JSON; rejects when it does not answer in time or answers nonsense. */
  request(): Promise<string>;
  /** Resolves once the page has written the settings, so a reload right after sees them. */
  apply(json: string): Promise<void>;
  onSettings(json: string): void;
  onApplied(): void;
}

export function createSettingsChannel(deps: {
  send(msg: NativeToWeb): void;
  timeoutMs: number;
}): SettingsChannel {
  let waitingSettings: ((json: string | Error) => void) | null = null;
  let waitingApplied: ((ok: true | Error) => void) | null = null;
  const failure = () => new Error("the page settings did not arrive");

  // One question to the page: `park` stores the callback that takes its answer, and a timeout settles it with a failure.
  function ask<R>(
    park: (settle: ((answer: R | Error) => void) | null) => void,
    send: () => void,
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        park(null);
        reject(failure());
      }, deps.timeoutMs);
      park((answer) => {
        clearTimeout(timer);
        park(null);
        if (answer instanceof Error) reject(answer);
        else resolve(answer);
      });
      send();
    });
  }

  return {
    request() {
      return ask<string>(
        (settle) => {
          waitingSettings = settle;
        },
        () => deps.send({ v: 1, type: "needSettings" }),
      );
    },
    apply(json) {
      return ask<true>(
        (settle) => {
          waitingApplied = settle;
        },
        () => deps.send({ v: 1, type: "applySettings", json }),
      ).then(() => undefined);
    },
    onSettings(json) {
      waitingSettings?.(parseSettings(json) === null ? failure() : json);
    },
    onApplied() {
      waitingApplied?.(true);
    },
  };
}
