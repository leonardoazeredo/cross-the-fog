import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  NATIVE_TO_WEB_MESSAGES,
  PAGE_MESSAGES,
  SESSION_MESSAGES,
  WEB_TO_NATIVE_MESSAGES,
} from "../../../src/bridge/messages.js";
import { inspectWebToNative, parseNativeToWeb } from "../../../src/bridge/protocol.js";

// Every message type of both unions, by name, read out of the message tables: a type added to messages.ts fails these
// cases until it is listed here with a sample, and until the controller (or the session and page API) handles it
// or the list of types ignored on purpose names it. The controller's and the session's handler maps are checked
// against their unions by tsc; these cases check the maps are still declared that way.

const root = resolve(import.meta.dirname, "../../..");
// The sources are scanned without their comments: a commented-out case or literal is not one.
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (path: string) => withoutComments(readFileSync(resolve(root, path), "utf-8"));

const WEB_TO_NATIVE_TYPES = Object.keys(WEB_TO_NATIVE_MESSAGES);
const NATIVE_TO_WEB_TYPES = Object.keys(NATIVE_TO_WEB_MESSAGES);

function between(src: string, from: string, to?: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`${from} not found`);
  const end = to === undefined ? src.length : src.indexOf(to, start);
  if (end < 0) throw new Error(`${to} not found`);
  return src.slice(start, end);
}

// The keys of a handler map written at four spaces of indent: `ready: ...` or `"back:result": ...`.
const mapKeys = (src: string) =>
  [...src.matchAll(/^ {4}"?([\w:]+)"?: /gm)].map((m) => m[1] as string);

// The types the controller ignores with no handler of its own, on purpose. Empty today:
// `devAddActivity` has a handler that does nothing unless `__DEV__` (controller.test.ts pins both).
const IGNORED_ON_PURPOSE_BY_THE_CONTROLLER: string[] = [];

// The types in `types` that nothing handles and no one ignored on purpose.
const unhandled = (types: string[], handled: string[], ignored: string[]) =>
  types.filter((t) => !handled.includes(t) && !ignored.includes(t));

const uuid = "6f1c1a52-3f1e-4c55-9d52-0a1d6c2b7e10";
const fingerprint = "ab".repeat(32);
const savedAt = "2026-10-01T09:00:00.000Z";
const route = {
  id: uuid,
  createdAt: savedAt,
  mode: "loop",
  waypoints: [
    { lat: 10, lng: 20 },
    { lat: 10.01, lng: 20.01 },
  ],
  coords: [
    [20, 10],
    [20.01, 10.01],
  ],
  stats: { distanceM: 1000, seconds: 700, ascentM: null, descentM: null },
  gpx: "<gpx/>",
};

interface Row {
  /** A message the schema accepts and hands back unchanged. */
  valid: Record<string, unknown>;
  /** The same message with one field the schema rejects; absent for a message with no field to break. */
  bad?: Record<string, unknown>;
}

const WEB_TO_NATIVE: Record<string, Row> = {
  ready: { valid: {} },
  pickBackup: { valid: {} },
  needBytes: { valid: { fingerprint }, bad: { fingerprint: "x" } },
  loaded: { valid: { fingerprint, ok: true, tiles: 3 }, bad: { fingerprint, ok: true, tiles: 0 } },
  clearSavedFog: { valid: {} },
  retryReload: { valid: {} },
  export: {
    valid: { filename: "r.gpx", mime: "application/gpx+xml", text: "<gpx/>" },
    bad: { filename: "", mime: "application/gpx+xml", text: "<gpx/>" },
  },
  openExternal: { valid: { url: "https://example.com/" }, bad: { url: "ftp://example.com/" } },
  openAbout: { valid: {} },
  "back:result": { valid: { handled: true }, bad: { handled: "yes" } },
  sendRoute: { valid: { route }, bad: { route: { ...route, waypoints: [] } } },
  needTrack: { valid: { activityId: uuid }, bad: { activityId: "x" } },
  deleteActivity: { valid: { activityId: uuid }, bad: { activityId: "x" } },
  exportBinary: {
    valid: { exportId: "e1", name: "abcdef123456", index: 0, total: 1, files: 1, data: "AAEC" },
    bad: { exportId: "e1", name: "abcdef123456", index: 1, total: 1, files: 1, data: "AAEC" },
  },
  backup: { valid: {} },
  restore: { valid: {} },
  retryHistory: { valid: {} },
  settings: { valid: { json: "{}" }, bad: { json: "x".repeat(16_385) } },
  settingsApplied: { valid: {} },
  devAddActivity: { valid: {} },
};

const NATIVE_TO_WEB: Record<string, Row> = {
  reload: {
    valid: { fingerprint, name: "a.zip", savedAt, size: 10, role: "current" },
    bad: { fingerprint, name: "a.zip", savedAt, size: 10, role: "latest" },
  },
  chunk: {
    valid: { fingerprint, index: 0, total: 1, data: "AAEC" },
    bad: { fingerprint, index: 1, total: 1, data: "AAEC" },
  },
  none: { valid: {} },
  reloadSuspended: { valid: { savedAt }, bad: { savedAt: "yesterday" } },
  notice: { valid: { text: "hi" }, bad: { text: "" } },
  back: { valid: {} },
  routeStatus: {
    valid: { routeId: uuid, state: "waiting" },
    bad: { routeId: uuid, state: "lost" },
  },
  linkStatus: {
    valid: { paired: true, reachable: false },
    bad: { paired: "yes", reachable: false },
  },
  needSettings: { valid: {} },
  applySettings: { valid: { json: "{}" }, bad: { json: "x".repeat(16_385) } },
  trackUnavailable: {
    valid: { activityId: uuid, reason: "notFound" },
    bad: { activityId: uuid, reason: "gone" },
  },
  activities: { valid: { items: [] }, bad: { items: "none" } },
  exportStatus: {
    valid: { exportId: "e1", state: "saved" },
    bad: { exportId: "e1", state: "done" },
  },
  unreadableActivities: { valid: { count: 1 }, bad: { count: -1 } },
  stuckReleases: { valid: { count: 2 }, bad: { count: -1 } },
  historyState: { valid: { state: "keyLost" }, bad: { state: "gone" } },
  track: {
    valid: { activityId: uuid, index: 0, total: 1, points: [] },
    bad: { activityId: uuid, index: 0, total: 1, points: "none" },
  },
};

const msg = (type: string, fields: Record<string, unknown>, v = 1) =>
  JSON.stringify({ v, type, ...fields });

it("lists every page-to-app type of the schema, and no other", () => {
  expect(Object.keys(WEB_TO_NATIVE).sort()).toEqual([...WEB_TO_NATIVE_TYPES].sort());
  expect(WEB_TO_NATIVE_TYPES).toHaveLength(20);
});

it("lists every app-to-page type of the schema, and no other", () => {
  expect(Object.keys(NATIVE_TO_WEB).sort()).toEqual([...NATIVE_TO_WEB_TYPES].sort());
  expect(NATIVE_TO_WEB_TYPES).toHaveLength(17);
});

it("has no type in both directions", () => {
  expect(WEB_TO_NATIVE_TYPES.filter((t) => NATIVE_TO_WEB_TYPES.includes(t))).toEqual([]);
});

it.each(Object.entries(WEB_TO_NATIVE))(
  "page-to-app %s: a valid message passes unchanged, a broken one is dropped by name",
  (type, row) => {
    const parsed = inspectWebToNative(msg(type, row.valid));
    expect(parsed).toEqual({ ok: true, msg: { v: 1, type, ...row.valid } });
    const wrongVersion = inspectWebToNative(msg(type, row.valid, 2));
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) expect(wrongVersion.drop.type).toBe(type);
    if (row.bad) {
      const broken = inspectWebToNative(msg(type, row.bad));
      expect(broken.ok).toBe(false);
      if (!broken.ok) {
        expect(broken.drop.type).toBe(type);
        expect(broken.drop.paths.length).toBeGreaterThan(0);
      }
    }
  },
);

it.each(Object.entries(NATIVE_TO_WEB))(
  "app-to-page %s: a valid message passes unchanged, a broken one is dropped",
  (type, row) => {
    expect(parseNativeToWeb(msg(type, row.valid))).toEqual({ v: 1, type, ...row.valid });
    expect(parseNativeToWeb(msg(type, row.valid, 2))).toBeNull();
    if (row.bad) expect(parseNativeToWeb(msg(type, row.bad))).toBeNull();
  },
);

// `loaded` is two schemas of one type; a broken message is reported against the branch it came closest to, so the
// order and the shape of the union show in the paths named.
it("accepts both shapes of loaded and names the field that broke the one it was closest to", () => {
  const ok = { fingerprint, ok: true, tiles: 3 };
  const failed = { fingerprint, ok: false, reason: "checksum" };
  expect(inspectWebToNative(msg("loaded", ok)).ok).toBe(true);
  expect(inspectWebToNative(msg("loaded", failed)).ok).toBe(true);
  const dropped = (fields: Record<string, unknown>) => {
    const r = inspectWebToNative(msg("loaded", fields));
    return r.ok ? null : r.drop;
  };
  expect(dropped({ ...ok, tiles: 0 })).toEqual({ type: "loaded", paths: ["tiles"] });
  expect(dropped({ ...failed, reason: "nope" })).toEqual({ type: "loaded", paths: ["reason"] });
  // A tie between the two shapes goes to the first listed.
  expect(dropped({ fingerprint, ok: "maybe" })).toEqual({ type: "loaded", paths: ["ok", "tiles"] });
});

// parseNativeToWeb returns the parsed message or null for any failure, and nothing else reads the union, so the
// order of its members matters only if two of them could accept one message. Each type has one schema and a
// schema accepts only its own type literal, so none can; the reversed union proves it on every sample.
it("gives each app-to-page type one schema, so the order of the union cannot show", () => {
  for (const [type, schemas] of Object.entries(NATIVE_TO_WEB_MESSAGES)) {
    expect(schemas, type).toHaveLength(1);
  }
  const reversed = z.union(Object.values(NATIVE_TO_WEB_MESSAGES).flat().reverse());
  for (const [type, row] of Object.entries(NATIVE_TO_WEB)) {
    for (const fields of [row.valid, ...(row.bad ? [row.bad] : [])]) {
      const raw = msg(type, fields);
      const other = reversed.safeParse(JSON.parse(raw));
      expect(other.success ? other.data : null, type).toEqual(parseNativeToWeb(raw));
    }
  }
});

it("rejects each type in the other direction", () => {
  for (const [type, row] of Object.entries(WEB_TO_NATIVE)) {
    expect(parseNativeToWeb(msg(type, row.valid)), `${type} read as app to page`).toBeNull();
  }
  for (const [type, row] of Object.entries(NATIVE_TO_WEB)) {
    expect(inspectWebToNative(msg(type, row.valid)).ok, `${type} read as page to app`).toBe(false);
  }
});

// A type with no handler in the controller's map is a compile error, but only while the map is declared against
// the union: `satisfies Handlers<WebToNative>` is what makes it one.
it("keeps the controller's handler map checked against every page-to-app type", () => {
  const controller = read("src/controller.ts");
  expect(controller).toContain("} satisfies Handlers<WebToNative>;");
  const map = between(controller, "const handlers = {", "} satisfies Handlers<WebToNative>;");
  const keys = mapKeys(map);
  expect(unhandled(WEB_TO_NATIVE_TYPES, keys, IGNORED_ON_PURPOSE_BY_THE_CONTROLLER)).toEqual([]);
  expect(keys.filter((k) => !WEB_TO_NATIVE_TYPES.includes(k))).toEqual([]);
});

// The app-to-page types are two halves: the session answers one itself, the page API hands the other to
// `window.crossfog.on` listeners. A type is in exactly one, and each half is checked where it is declared.
it("splits the app-to-page types between the session and the page API, each half checked", () => {
  const sessionTypes = Object.keys(SESSION_MESSAGES);
  const pageEvents = Object.keys(PAGE_MESSAGES);
  expect([...sessionTypes, ...pageEvents].sort()).toEqual([...NATIVE_TO_WEB_TYPES].sort());
  expect(sessionTypes.filter((t) => pageEvents.includes(t))).toEqual([]);

  const session = read("web-adapter/session.ts");
  expect(session).toContain("} satisfies Handlers<SessionMessage>;");
  const map = between(session, "const handlers = {", "} satisfies Handlers<SessionMessage>;");
  const keys = mapKeys(map);
  expect(keys.sort()).toEqual([...sessionTypes].sort());

  // PAGE_EVENTS is the page half's keys, not a second list.
  expect(read("web-adapter/pageApi.ts")).toContain("Object.keys(PAGE_MESSAGES)");
  // A page event only reaches the page once something subscribes: an event no `crossfog.on(...)` in index.ts
  // names is dropped without a word.
  const index = read("web-adapter/index.ts");
  expect(pageEvents.filter((t) => !index.includes(`.on("${t}"`))).toEqual([]);
});

it("finds a type nothing handles and the keys of a map (control for the helpers of the cases above)", () => {
  expect(unhandled(["a", "b"], ["a"], [])).toEqual(["b"]);
  expect(unhandled(["a", "b"], ["a"], ["b"])).toEqual([]);
  // Only the keys at the map's own indent, quoted or not; a line inside a handler body is not one.
  expect(
    mapKeys(
      '    ready: () => {},\n    "back:result": (m) => {\n      const x: 1 = 1;\n    },\n  other: 1,',
    ),
  ).toEqual(["ready", "back:result"]);
  // A key in a comment is not one: the sources are read without their comments.
  expect(mapKeys(withoutComments("    // ghost: 1\n    ready: () => {},"))).toEqual(["ready"]);
});

it("keys each message table by the type literal of every schema under the key", () => {
  for (const table of [WEB_TO_NATIVE_MESSAGES, NATIVE_TO_WEB_MESSAGES]) {
    for (const [type, schemas] of Object.entries(table)) {
      expect(schemas.length, `${type} has a schema`).toBeGreaterThan(0);
      for (const schema of schemas) expect(schema.shape.type.value, type).toBe(type);
    }
  }
});
