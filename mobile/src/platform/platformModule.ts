import Platform, {
  type KeyPresence,
  type KeyState,
  type PlatformNativeEvents,
} from "../../modules/platform";
import { checkedKeyHex, type DatabaseKeyHex } from "../db/keyHex.js";
import { StagingKeyUnusableError } from "../link/stagingKeyError.js";

export type { KeyPresence, KeyState, PlatformNativeEvents };

/** The native side found no usable database key although one was created before. */
export class KeyLostError extends Error {
  override name = "KeyLostError";
}

/**
 * The native side could not reach the key (a busy Keystore, a failed read or write); unlike
 * `KeyLostError` it says nothing about whether the key is still there.
 */
export class KeyUnavailableError extends Error {
  override name = "KeyUnavailableError";
}

// The two codes from `ModuleFailures.kt` that keyCall maps; any other passes through.
const ERR_KEY_LOST = "ERR_KEY_LOST";
const ERR_KEY_UNAVAILABLE = "ERR_KEY_UNAVAILABLE";

// A Record over KeyState, so a state added to the type is a compile error here until it is listed (a list
// checked with `satisfies` would only reject a wrong member, not a missing one).
const KEY_STATE_NAMES: Record<KeyState, true> = {
  fresh: true,
  existing: true,
  lost: true,
  unreadable: true,
};
const KEY_STATES = Object.keys(KEY_STATE_NAMES);

async function keyCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
    if (code === ERR_KEY_LOST) throw new KeyLostError("database key is lost", { cause: e });
    if (code === ERR_KEY_UNAVAILABLE) {
      throw new KeyUnavailableError("cannot reach the database key", { cause: e });
    }
    throw e;
  }
}

export async function getDatabaseKeyHex(): Promise<DatabaseKeyHex> {
  return checkedKeyHex(await keyCall(() => Platform.getDatabaseKeyHex()));
}

/**
 * Keeps `keyHex` as the database key in place of a lost or unreadable one; the native side refuses
 * unless `keyState` reads `lost` or `unreadable`. The key is checked again because a cast can get
 * any string past the type.
 */
export async function replaceLostDatabaseKey(keyHex: DatabaseKeyHex): Promise<void> {
  const checked = checkedKeyHex(keyHex);
  await keyCall(() => Platform.replaceLostDatabaseKey(checked));
}

/**
 * Drops a lost or unreadable database key so the next read mints a new one; the native side refuses
 * while the live database or a restore's replaced copy exists, or the key state reads `existing`.
 */
export async function resetKeys(): Promise<void> {
  await keyCall(() => Platform.resetKeys());
}

/** The system save-as picker; null when the user backs out. */
export function createDocument(name: string, mime: string): Promise<string | null> {
  return Platform.createDocument(name, mime);
}

/** The name the provider gave a document, or null when it will not say. */
export function displayNameOf(uri: string): Promise<string | null> {
  return Platform.displayNameOf(uri);
}

/** Streams a cache file into a document; returns the bytes written. */
export function copyToUri(sourcePath: string, uri: string): Promise<number> {
  return Platform.copyToUri(sourcePath, uri);
}

/** Streams a document into a cache file; `head` is its first 16 bytes (fewer for a shorter file) as hex. */
export async function copyFromUri(
  uri: string,
  destPath: string,
): Promise<{ size: number; head: string }> {
  const r = await Platform.copyFromUri(uri, destPath);
  if (
    typeof r?.size !== "number" ||
    typeof r.head !== "string" ||
    !/^[0-9a-f]{0,32}$/.test(r.head)
  ) {
    throw new Error("watch link returned a malformed copy result");
  }
  return { size: r.size, head: r.head };
}

function checkedState(state: KeyState): KeyState {
  if (!KEY_STATES.includes(state)) throw new Error("watch link returned an unknown key state");
  return state;
}

export async function keyState(): Promise<KeyState> {
  return checkedState(await keyCall(() => Platform.keyState()));
}

/** Which halves are present, without unwrapping the key; `unreadable` needs `keyState`. */
export async function keyPresence(): Promise<KeyPresence> {
  const state = checkedState(await keyCall(() => Platform.keyPresence()));
  if (state === "unreadable") throw new Error("watch link returned an unknown key state");
  return state;
}

// What follows returns native values unchecked: src/link/watchLink.ts validates them.

export function linkStatus(): Promise<unknown> {
  return Platform.status();
}

/** Rejects with `ERR_NO_TRANSPORT` until a radio adapter exists, and `ERR_INVALID_QR` for a code it cannot read. */
export function pairWatch(qr: string): Promise<void> {
  return Platform.pair(qr);
}

export function unpairWatch(): Promise<void> {
  return Platform.unpair();
}

export function pendingActivities(): Promise<unknown> {
  return Platform.pendingActivities();
}

export function unreadableActivities(): Promise<unknown> {
  return Platform.unreadableActivities();
}

export function discardUnreadableRoutes(): Promise<unknown> {
  return Platform.discardUnreadableRoutes();
}

// The one staging code from `ModuleFailures.kt` that the page words on its own; any other passes through.
const ERR_STAGING_KEY_UNUSABLE = "ERR_STAGING_KEY_UNUSABLE";

async function stagingCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
    if (code === ERR_STAGING_KEY_UNUSABLE) {
      throw new StagingKeyUnusableError("the staging key cannot be used", { cause: e });
    }
    throw e;
  }
}

export function readActivity(id: string): Promise<string> {
  return stagingCall(() => Platform.readActivity(id));
}

export function releaseActivity(id: string): Promise<void> {
  return stagingCall(() => Platform.release(id));
}

export function queueRoute(routeJson: string): Promise<void> {
  return stagingCall(() => Platform.queueRoute(routeJson));
}

/** Returns the function that removes the listener. */
export function onLinkEvent(
  event: keyof PlatformNativeEvents,
  fn: (payload: unknown) => void,
): () => void {
  const subscription = Platform.addListener(event, fn);
  return () => subscription.remove();
}
