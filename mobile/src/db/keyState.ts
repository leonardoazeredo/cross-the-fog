import type { KeyState } from "../platform/platformModule.js";

/**
 * Whether the device key may be replaced or dropped: its two halves cannot be used together, now
 * or on any later read. `existing` is not, since it may still read on a retry, and a database it
 * protects would become unreadable.
 */
export function keyIsLostOrUnreadable(state: KeyState): state is "lost" | "unreadable" {
  return state === "lost" || state === "unreadable";
}
