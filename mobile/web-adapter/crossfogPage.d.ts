import type {
  ActivitySummary,
  ExportState,
  RouteRecord,
  TrackPoint,
  TrackUnavailableReason,
} from "../src/bridge/protocol.js";

// app/src/reveal.ts `Reveal.RULES`: a cached reveal is reused only while a hash of all these fields matches.
export interface RevealRules {
  version: number;
  maxAccuracyM: number;
  maxGapS: number;
  maxGapM: number;
  halfWidthM: number;
}

// The one declaration of what app/src/main.js hands the adapter as `window.CrossfogPage`. The adapter reads it
// (history.ts, index.ts, loader.ts) and the contract check (scripts/web/contract.ts) lists a path for each field
// of it, so a field added here without a path there does not compile. The page itself is not type-checked.
export interface CrossfogPageApi {
  fogMap: {
    addCells(cells: Int32Array): number;
    clearOverlay(): void;
  };
  fogChanged(): void;
  /** The History tab; absent on a page without it. */
  history?: {
    setActivities(items: ActivitySummary[]): void;
    setTrack(
      activityId: string,
      points: TrackPoint[],
      route?: { coords: RouteRecord["coords"] },
    ): void;
    trackUnavailable(activityId: string, reason: TrackUnavailableReason): void;
    setUnreadable?(count: number): void;
    setState?(state: "ready" | "keyLost" | "openFailed"): void;
  };
  /** The Send button's answers from the phone. */
  routeStatus?(msg: {
    routeId: string;
    state: string;
    why?: string | undefined;
    revision?: string | undefined;
  }): void;
  linkStatus?(msg: {
    paired: boolean;
    reachable: boolean;
    unsentRoutes?: number | undefined;
  }): void;
  /** What became of a Fog of World export the page sent. */
  exportStatus?(msg: { exportId: string; state: ExportState }): void;
  reveal: {
    RULES: RevealRules;
    reveal(
      track: Array<{ t: number; lat: number; lon: number; accuracy?: number | undefined }>,
      rules: RevealRules,
    ): Int32Array;
  };
  /** The damaged tile files of the latest import; a page that does not publish it counts as no damage. */
  lastImport?: { corrupt: number };
}

declare global {
  interface Window {
    CrossfogPage?: CrossfogPageApi;
  }
}
