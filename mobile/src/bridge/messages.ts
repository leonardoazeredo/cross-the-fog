import { z } from "zod";

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const shortName = z.string().min(1).max(255);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
// Unpadded or ragged input would make the decoded size depend on the decoder, so the byte cap below could not be exact.
// A flat character class plus a length check: a repeated-group regex overflows the stack on multi-megabyte input.
const base64Data = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine((s) => s.length % 4 === 0, "base64 must be padded to a multiple of 4");

function base64Bytes(s: string): number {
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

// Shared so the three chunk schemas (exportBinary, chunk, track) cannot disagree on the index and total bounds.
const chunkIndex = z.number().int().min(0);
const chunkTotal = z.number().int().min(1);
const indexBelowTotal = (c: { index: number; total: number }) => c.index < c.total;
const INDEX_BELOW_TOTAL = "index must be less than total";

// The page's f2m_* settings as JSON; src/backup/settings.ts checks the content, this bounds the message.
const settingsJson = z.string().max(16_384);

// The page's fowExport.js CHUNK_BYTES must equal this; test/unit/bridge/exportLimits.test.ts compares them.
export const EXPORT_CHUNK_BYTES = 1_048_576;
// exportId and tileFileName become path segments under the cache.
export const exportId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const tileFileName = z.string().regex(/^[a-z0-9]{1,32}$/);
// 0xffff in a zip's entry count means "see the ZIP64 record", so a zip without ZIP64 holds one fewer.
export const EXPORT_MAX_FILES = 65_534;
// 1024 chunks of 1 MiB per file: far above any Sync tile.
const EXPORT_MAX_CHUNKS = 1024;
export const TRACK_CHUNK_POINTS = 2000;
// Bounds on a route, far above what a planned route needs; they keep one message from exhausting memory. The coordinate
// cap also applies to the followed route the phone sends with a track.
const ROUTE_MAX_POINTS = 100_000;
const ROUTE_MAX_WAYPOINTS = 500;
const ROUTE_MAX_GPX_CHARS = 10_000_000;

export const uuid = z.uuid();
const nonNegative = z.number().min(0);
const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);

const routeCoords = z
  .array(z.tuple([lon, lat, z.number().optional()]))
  .min(2)
  .max(ROUTE_MAX_POINTS);

// `ascentM` and `descentM` are null when no elevation arrived (app/src/routeLocal.ts). The page gives every
// route a walking time (app/src/estimates.ts), but a null `seconds` is accepted too: a route without
// one is sent rather than rejected.
// The SHA-256 of a route's GPX as UTF-8 bytes, 64 lowercase hex digits: the value link/'s `Revision` computes.
const routeRevision = z.string().regex(/^[0-9a-f]{64}$/);

export const routeRecord = z.object({
  id: uuid,
  createdAt: isoDate,
  mode: z.enum(["loop", "p2p"]),
  targetDistanceM: nonNegative.optional(),
  waypoints: z
    .array(z.object({ lat, lng: lon }))
    .min(2)
    .max(ROUTE_MAX_WAYPOINTS),
  coords: routeCoords,
  stats: z.object({
    distanceM: nonNegative,
    seconds: nonNegative.nullable(),
    ascentM: nonNegative.nullable(),
    descentM: nonNegative.nullable(),
  }),
  gpx: z.string().max(ROUTE_MAX_GPX_CHARS),
  // The page's own hash of `gpx`; the phone computes the real one and refuses a send where they differ.
  revision: routeRevision.optional(),
});

export const activitySummary = z.object({
  id: uuid,
  startedAt: isoDate,
  endedAt: isoDate,
  routeId: uuid.optional(),
  stats: z.object({
    durationS: nonNegative,
    distanceM: nonNegative,
    paceSPerKm: nonNegative.optional(),
    steps: nonNegative.optional(),
    calories: nonNegative.optional(),
    heartRateAvg: nonNegative.optional(),
    heartRateMax: nonNegative.optional(),
  }),
});

export const trackPoint = z.object({
  t: nonNegative,
  lat,
  lon,
  accuracy: nonNegative.optional(),
  elevation: z.number().optional(),
  speed: nonNegative.optional(),
  heartRate: nonNegative.optional(),
  steps: nonNegative.optional(),
  cadence: nonNegative.optional(),
});

// Every page-to-app message, by type. A type with two shapes lists both, in the order the union tries them:
// a broken message is reported against the branch it came closest to (describeDrop in protocol.ts).
export const WEB_TO_NATIVE_MESSAGES = {
  ready: [z.object({ v: z.literal(1), type: z.literal("ready") })],
  pickBackup: [z.object({ v: z.literal(1), type: z.literal("pickBackup") })],
  needBytes: [z.object({ v: z.literal(1), type: z.literal("needBytes"), fingerprint })],
  loaded: [
    z.object({
      v: z.literal(1),
      type: z.literal("loaded"),
      fingerprint,
      ok: z.literal(true),
      tiles: z.number().int().min(1),
    }),
    z.object({
      v: z.literal(1),
      type: z.literal("loaded"),
      fingerprint,
      ok: z.literal(false),
      reason: z.enum(["unzip", "noTiles", "corrupt", "memory", "checksum", "unknown"]),
    }),
  ],
  clearSavedFog: [z.object({ v: z.literal(1), type: z.literal("clearSavedFog") })],
  retryReload: [z.object({ v: z.literal(1), type: z.literal("retryReload") })],
  export: [
    z.object({
      v: z.literal(1),
      type: z.literal("export"),
      filename: shortName,
      mime: z.string().min(1).max(100),
      text: z.string(),
    }),
  ],
  openExternal: [
    z.object({
      v: z.literal(1),
      type: z.literal("openExternal"),
      url: z.string().regex(/^https?:\/\//),
    }),
  ],
  openAbout: [z.object({ v: z.literal(1), type: z.literal("openAbout") })],
  "back:result": [
    z.object({ v: z.literal(1), type: z.literal("back:result"), handled: z.boolean() }),
  ],
  sendRoute: [z.object({ v: z.literal(1), type: z.literal("sendRoute"), route: routeRecord })],
  needTrack: [z.object({ v: z.literal(1), type: z.literal("needTrack"), activityId: uuid })],
  deleteActivity: [
    z.object({ v: z.literal(1), type: z.literal("deleteActivity"), activityId: uuid }),
  ],
  exportBinary: [
    z
      .object({
        v: z.literal(1),
        type: z.literal("exportBinary"),
        exportId,
        name: tileFileName,
        index: chunkIndex,
        total: chunkTotal.max(EXPORT_MAX_CHUNKS),
        files: z.number().int().min(1).max(EXPORT_MAX_FILES),
        data: base64Data
          .max(Math.ceil(EXPORT_CHUNK_BYTES / 3) * 4)
          .refine((s) => base64Bytes(s) <= EXPORT_CHUNK_BYTES, "chunk is over 1 MiB"),
      })
      .refine(indexBelowTotal, INDEX_BELOW_TOTAL),
  ],
  backup: [z.object({ v: z.literal(1), type: z.literal("backup") })],
  restore: [z.object({ v: z.literal(1), type: z.literal("restore") })],
  // The History tab's Try again after a history that could not be opened.
  retryHistory: [z.object({ v: z.literal(1), type: z.literal("retryHistory") })],
  settings: [z.object({ v: z.literal(1), type: z.literal("settings"), json: settingsJson })],
  settingsApplied: [z.object({ v: z.literal(1), type: z.literal("settingsApplied") })],
  // Only the e2e page sends it and only a debug app acts on it; the schema is harmless in release.
  devAddActivity: [z.object({ v: z.literal(1), type: z.literal("devAddActivity") })],
};

// The app-to-page messages the session handles itself: it loads the fog the phone sends and shows its status, and
// answers the back button and the settings.
export const SESSION_MESSAGES = {
  reload: [
    z.object({
      v: z.literal(1),
      type: z.literal("reload"),
      fingerprint,
      name: shortName,
      savedAt: isoDate,
      size: z.number().int().min(0),
      role: z.enum(["current", "pending"]),
    }),
  ],
  chunk: [
    z
      .object({
        v: z.literal(1),
        type: z.literal("chunk"),
        fingerprint,
        index: chunkIndex,
        total: chunkTotal,
        data: base64Data,
      })
      .refine(indexBelowTotal, INDEX_BELOW_TOTAL),
  ],
  none: [z.object({ v: z.literal(1), type: z.literal("none") })],
  reloadSuspended: [
    z.object({ v: z.literal(1), type: z.literal("reloadSuspended"), savedAt: isoDate }),
  ],
  notice: [
    z.object({
      v: z.literal(1),
      type: z.literal("notice"),
      text: z.string().min(1).max(500),
    }),
  ],
  back: [z.object({ v: z.literal(1), type: z.literal("back") })],
  needSettings: [z.object({ v: z.literal(1), type: z.literal("needSettings") })],
  applySettings: [
    z.object({ v: z.literal(1), type: z.literal("applySettings"), json: settingsJson }),
  ],
};

// The app-to-page messages the page API hands to `window.crossfog.on` listeners (PAGE_EVENTS in
// web-adapter/pageApi.ts is these keys). A type is in one of the two tables, so the session cannot also answer it.
export const PAGE_MESSAGES = {
  routeStatus: [
    z.object({
      v: z.literal(1),
      type: z.literal("routeStatus"),
      routeId: uuid,
      state: z.enum(["waiting", "onWatch", "failed"]),
      why: z.string().max(500).optional(),
      // Which GPX of this route id the state is for; absent for a status of a build with no revisions.
      revision: routeRevision.optional(),
    }),
  ],
  linkStatus: [
    z.object({
      v: z.literal(1),
      type: z.literal("linkStatus"),
      paired: z.boolean(),
      reachable: z.boolean(),
      // Queued routes the phone had to drop because they could never be opened; absent when none.
      unsentRoutes: z.number().int().positive().optional(),
    }),
  ],
  activities: [
    z.object({ v: z.literal(1), type: z.literal("activities"), items: z.array(activitySummary) }),
  ],
  track: [
    z
      .object({
        v: z.literal(1),
        type: z.literal("track"),
        activityId: uuid,
        index: chunkIndex,
        total: chunkTotal,
        points: z.array(trackPoint).max(TRACK_CHUNK_POINTS),
        // The route the activity followed; only the first chunk carries it.
        route: z.object({ coords: routeCoords }).optional(),
      })
      .refine(indexBelowTotal, INDEX_BELOW_TOTAL),
  ],
  // The answer to a needTrack for an activity that is gone or cannot be read, so the detail stops waiting.
  trackUnavailable: [
    z.object({
      v: z.literal(1),
      type: z.literal("trackUnavailable"),
      activityId: uuid,
      reason: z.enum(["notFound", "readFailed"]),
    }),
  ],
  // Activities the watch handed over that stay staged because the phone cannot read them.
  unreadableActivities: [
    z.object({
      v: z.literal(1),
      type: z.literal("unreadableActivities"),
      count: z.number().int().min(0),
    }),
  ],
  // Walks the phone stored but whose staged copy it could not clear in several passes; nothing is lost, and it tries again each pass.
  stuckReleases: [
    z.object({
      v: z.literal(1),
      type: z.literal("stuckReleases"),
      count: z.number().int().min(0),
    }),
  ],
  // Whether the history can be read: `keyLost` and `openFailed` say why the History tab is empty. Sent when it changes and to a page that has just loaded.
  historyState: [
    z.object({
      v: z.literal(1),
      type: z.literal("historyState"),
      state: z.enum(["ready", "keyLost", "openFailed"]),
    }),
  ],
  // How a Fog of World export went: `saving` just before the picker opens, then one of the other three.
  exportStatus: [
    z.object({
      v: z.literal(1),
      type: z.literal("exportStatus"),
      exportId,
      state: z.enum(["saving", "saved", "cancelled", "failed"]),
    }),
  ],
};

// The whole app-to-page set, which is what `nativeToWebSchema` parses; the split above is for who handles a type.
export const NATIVE_TO_WEB_MESSAGES = { ...SESSION_MESSAGES, ...PAGE_MESSAGES };
