import { z } from "zod";
import type { RouteRecord } from "../bridge/protocol.js";

export const linkStatusSchema = z.object({ paired: z.boolean(), reachable: z.boolean() });

const uuid = z.uuid();
const encoderVersion = z.string().min(1).max(64);

/** What the list of staged activities carries; the file stays behind `readActivity`. */
export const pendingActivitySchema = z.object({
  activityId: uuid,
  routeId: uuid.optional(),
  encoderVersion,
});

export const activityOfferSchema = pendingActivitySchema.extend({ gpx: z.string().min(1) });

export type LinkStatus = z.infer<typeof linkStatusSchema>;
export type PendingActivity = z.infer<typeof pendingActivitySchema>;
export type ActivityOffer = z.infer<typeof activityOfferSchema>;

export interface WatchLinkEvents {
  activityStaged: { activityId: string };
  linkStatus: LinkStatus;
  /** `revision` is the one the watch saved; absent from a watch that sends none. */
  routeSaved: { routeId: string; revision?: string | undefined };
}

export interface WatchLink {
  pair(qrPayload: string): Promise<void>;
  status(): Promise<LinkStatus>;
  /** Persists the route on the phone, across the app closing, until the watch confirms it with `routeSaved`. Nothing delivers it yet. */
  queueRoute(route: RouteRecord): Promise<void>;
  pendingActivities(): Promise<PendingActivity[]>;
  /**
   * How many staged items cannot be decrypted, parsed or matched to their file name; they are never
   * listed and stay staged. The native count only: `HandOffResult.unreadable` adds the listed walks
   * whose GPX fails `parseGpx` or whose id does not match the staged one.
   */
  unreadableActivities(): Promise<number>;
  /** Rejects for an id that is not staged. */
  readActivity(id: string): Promise<ActivityOffer>;
  /** Only after the activity is committed to the phone's activity store. A well-formed id that is not staged is a no-op; a malformed id rejects. */
  release(id: string): Promise<void>;
  /**
   * Removes the queued routes that can never be opened (sealed before a lost staging alias) and returns
   * how many it removed: the user sends them again. With an unusable staging entry nothing is known to
   * be lost, so it keeps every route and returns 0.
   */
  discardUnreadableRoutes(): Promise<number>;
  /** Returns the function that removes the listener. */
  on<E extends keyof WatchLinkEvents>(
    event: E,
    fn: (payload: WatchLinkEvents[E]) => void,
  ): () => void;
}
