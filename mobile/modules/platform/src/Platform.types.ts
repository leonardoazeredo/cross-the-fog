// "existing": the key file and the Keystore key are both present and the key did not fail for good
// (it may still fail on a read); "unreadable": both are present but unwrapping fails for good.
export type KeyState = "fresh" | "existing" | "lost" | "unreadable";

export type PlatformNativeEvents = {
  activityStaged(event: { activityId: string }): void;
  linkStatus(event: { paired: boolean; reachable: boolean }): void;
  /** `revision` is the one of the route the watch saved, as the 64 hex characters the wire carries. */
  routeSaved(event: { routeId: string; revision: string }): void;
  /** A route that failed on the phone every time and was moved out of the queue, not deleted. */
  routeSetAside(event: { routeId: string; revision?: string }): void;
};
