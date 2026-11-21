import type { ActivitySummary, RouteRecord, TrackPoint } from "../bridge/protocol.js";

export type { ActivitySummary, RouteRecord };

export interface Activity extends ActivitySummary {
  /** The file as the watch's encoder wrote it; the track is rebuildable from it. */
  gpx: string;
  track: TrackPoint[];
  receivedAt: string;
  encoderVersion: string;
}

export type ActivityDetail = Omit<Activity, "gpx">;

export type StoredRoute = RouteRecord & { sentAt?: string };

/**
 * What a list shows; the geometry and the file stay behind `get`. Picked, not omitted, so a field
 * added to RouteRecord stays out of lists until it is named here.
 */
export type RouteSummary = Pick<
  StoredRoute,
  "id" | "createdAt" | "mode" | "targetDistanceM" | "stats" | "sentAt"
>;

/** `markSent` for an id the store does not hold; the id is a property, never in the message. */
export class UnknownRouteError extends Error {
  override name = "UnknownRouteError";
  constructor(readonly id: string) {
    super("unknown route");
  }
}

export interface ActivityStore {
  /** Idempotent by id: a known id changes nothing and reports `stored: false`. */
  add(activity: Activity): Promise<{ stored: boolean }>;
  /** The rows that read; a row whose JSON does not parse is left out (`listReadable` counts it). */
  list(): Promise<ActivitySummary[]>;
  /** `list` plus how many rows could not be read, so the page can say so instead of hiding them. */
  listReadable(): Promise<{ items: ActivitySummary[]; unreadable: number }>;
  /** Everything but the GPX, so a bad GPX blob cannot hide a track that is fine. */
  get(id: string): Promise<ActivityDetail | null>;
  /**
   * Inflates the GPX text on demand; rejects when the stored blob cannot be inflated or its checksum
   * does not match. A caller must not turn that rejection into null: null means no such activity.
   */
  gpx(id: string): Promise<string | null>;
  delete(id: string): Promise<boolean>;
}

export interface RouteStore {
  /** Replaces a route saved under the same id, `sentAt` included: the edited route is not the one the watch has. */
  save(route: RouteRecord): Promise<void>;
  get(id: string): Promise<StoredRoute | null>;
  /** The rows that read; a row whose JSON does not parse is left out (`listReadable` counts it). */
  list(): Promise<RouteSummary[]>;
  listReadable(): Promise<{ items: RouteSummary[]; unreadable: number }>;
  /** Throws for an unknown id, so a lost route is not mistaken for a delivered one. */
  markSent(id: string): Promise<void>;
}
