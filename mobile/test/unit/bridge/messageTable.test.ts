import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { NATIVE_TO_WEB_MESSAGES, WEB_TO_NATIVE_MESSAGES } from "../../../src/bridge/messages.js";
import { inspectWebToNative, parseNativeToWeb } from "../../../src/bridge/protocol.js";

// Every message type of both unions, by name, read out of the message tables: a type added to messages.ts fails these
// cases until it is listed here with a sample, and until the controller (or the session and page API) handles it
// or the list of types ignored on purpose names it. The controller's switch has no `never` check, so a type with
// no case compiles and is dropped without a word; these cases are what notices it.

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

const casesIn = (src: string) => [...src.matchAll(/case "([^"]+)":/g)].map((m) => m[1] as string);

// The types the controller and the session answer to with no case of their own, on purpose. Empty today:
// `devAddActivity` has a case that does nothing unless `__DEV__` (controller.test.ts pins both).
const IGNORED_ON_PURPOSE_BY_THE_CONTROLLER: string[] = [];
const IGNORED_ON_PURPOSE_BY_THE_PAGE_SIDE: string[] = [];

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
  track: {
    valid: { activityId: uuid, index: 0, total: 1, points: [] },
    bad: { activityId: uuid, index: 0, total: 1, points: "none" },
  },
};

const msg = (type: string, fields: Record<string, unknown>, v = 1) =>
  JSON.stringify({ v, type, ...fields });

it("lists every page-to-app type of the schema, and no other", () => {
  expect(Object.keys(WEB_TO_NATIVE).sort()).toEqual([...WEB_TO_NATIVE_TYPES].sort());
  expect(WEB_TO_NATIVE_TYPES).toHaveLength(19);
});

it("lists every app-to-page type of the schema, and no other", () => {
  expect(Object.keys(NATIVE_TO_WEB).sort()).toEqual([...NATIVE_TO_WEB_TYPES].sort());
  expect(NATIVE_TO_WEB_TYPES).toHaveLength(15);
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
  const keys = [...map.matchAll(/^ {4}"?([\w:]+)"?: /gm)].map((m) => m[1] as string);
  expect(unhandled(WEB_TO_NATIVE_TYPES, keys, IGNORED_ON_PURPOSE_BY_THE_CONTROLLER)).toEqual([]);
  expect(keys.filter((k) => !WEB_TO_NATIVE_TYPES.includes(k))).toEqual([]);
});

it("gives every app-to-page type a route in the session or the page API, or names it as ignored on purpose", () => {
  const session = casesIn(
    between(read("web-adapter/session.ts"), "async onMessage(msg: NativeToWeb)"),
  );
  const pageEvents = [
    ...between(read("web-adapter/pageApi.ts"), "const PAGE_EVENTS = [", "] as const").matchAll(
      /"([^"]+)"/g,
    ),
  ].map((m) => m[1] as string);
  expect(
    unhandled(
      NATIVE_TO_WEB_TYPES,
      [...session, ...pageEvents],
      IGNORED_ON_PURPOSE_BY_THE_PAGE_SIDE,
    ),
  ).toEqual([]);
  expect([...session, ...pageEvents].filter((t) => !NATIVE_TO_WEB_TYPES.includes(t))).toEqual([]);
  // Listing an event in PAGE_EVENTS routes it to the page API, but the page hears it only once something
  // subscribes: an event no `crossfog.on(...)` in index.ts names is dropped without a word.
  const index = read("web-adapter/index.ts");
  expect(pageEvents.filter((t) => !index.includes(`.on("${t}"`))).toEqual([]);
  // A page event reaches the page API only through the session's default branch: a session case for the same
  // type would shadow it, and the page would never hear it.
  expect(session.filter((t) => pageEvents.includes(t))).toEqual([]);
});

it("finds a type nothing handles (control for the two cases above)", () => {
  expect(unhandled(["a", "b"], ["a"], [])).toEqual(["b"]);
  expect(unhandled(["a", "b"], ["a"], ["b"])).toEqual([]);
  expect(casesIn('switch (x) { case "a": break; case "b:c": break; }')).toEqual(["a", "b:c"]);
  expect(
    casesIn(
      withoutComments('switch (x) {\n  // case "a":\n  /* case "b": */\n  case "c": break; }'),
    ),
  ).toEqual(["c"]);
});

it("keys each message table by the type literal of every schema under the key", () => {
  for (const table of [WEB_TO_NATIVE_MESSAGES, NATIVE_TO_WEB_MESSAGES]) {
    for (const [type, schemas] of Object.entries(table)) {
      expect(schemas.length, `${type} has a schema`).toBeGreaterThan(0);
      for (const schema of schemas) expect(schema.shape.type.value, type).toBe(type);
    }
  }
});
