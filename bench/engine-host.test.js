// The converted network modules read the page only through the host they are given: Overpass through the
// object bindOverpassHost gets, TileStore.open through its first argument. Every other test binds globalThis,
// where reading a global and reading the host look the same, so this one binds a host that is not globalThis
// and makes the globals wrong.
//   node bench/engine-host.test.js
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
require("./lib/load.js");
const { createFakeIDB } = require("./lib/fake-idb.js");
const src = path.join(__dirname, "..", "app", "src");
const { Overpass, bindOverpassHost } = require(path.join(src, "overpass.ts"));
const { open } = require(path.join(src, "tileStore.ts"));
const { pageGlobals } = require(path.join(src, "pageGlobals.ts"));
const { bindStreetsHost } = require(path.join(src, "streets.ts"));
const { bindPlannerHost } = require(path.join(src, "planner.ts"));
const { bindSuggestHost } = require(path.join(src, "suggest.ts"));

const answer = (status) => ({ ok: status === 200, status, body: null, headers: { get: () => null }, json: async () => ({ elements: [] }) });
const KEY = "made-up-key/9"; // a made-up key, as in every other test

(async () => {
  const warn = console.warn; console.warn = () => {};
  const realFetch = global.fetch;
  const realIdb = global.indexedDB;
  const hadNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  try {
    // the global fetch throws and the global key is unset; the blocks below set the global to what the host does not say
    global.fetch = () => { throw new Error("read the global fetch"); };
    delete global.crossfogNextgisKey;
    Object.defineProperty(global, "navigator", { value: { onLine: true }, configurable: true, writable: true });

    { // fetch and the key come from the host, each read when the call runs
      const calls = [];
      const host = { fetch: async (url) => { calls.push(url); return answer(200); }, navigator: { onLine: true } };
      Overpass._reset();
      bindOverpassHost(host);
      assert.equal(Overpass.has("nextgis"), false, "no key on the host");
      global.crossfogNextgisKey = KEY; // a key on the global is not the host's
      assert.equal(Overpass.has("nextgis"), false, "the global key is not read");
      delete global.crossfogNextgisKey;
      host.crossfogNextgisKey = KEY; // set after binding
      assert.equal(Overpass.has("nextgis"), true, "the host's key, read at each call");
      assert.equal(Overpass.cap(), 4, "cap reads the host's key too");
      await Overpass.post("data=x");
      assert.equal(calls.length, 1, "the post went through the host's fetch");
      assert.ok(calls[0].startsWith("https://overpass.nextgis.com/"), "NextGIS first once the host holds a key");
      delete host.crossfogNextgisKey;
      assert.equal(Overpass.has("nextgis"), false, "a key taken away is gone at once");
    }
    { // navigator.onLine is the host's: a 500 with a host that is offline reads as offline, with one that is online as server
      for (const [onLine, reason] of [[false, "offline"], [true, "server"]]) {
        Overpass._reset();
        bindOverpassHost({ fetch: async () => answer(500), navigator: { onLine } });
        await assert.rejects(Overpass.post("data=x"), (e) => e.reason === reason, "onLine " + onLine);
      }
      Overpass._reset();
      bindOverpassHost({ fetch: async () => answer(500) }); // no navigator on the host: the global's is not read
      Object.defineProperty(global, "navigator", { value: { onLine: false }, configurable: true, writable: true });
      await assert.rejects(Overpass.post("data=x"), (e) => e.reason === "server", "the global navigator is not read");
    }
    { // a host with no fetch is a rejected fetch, never a read of the global one
      Overpass._reset();
      bindOverpassHost({});
      await assert.rejects(Overpass.post("data=x"), (e) => e.reason === "offline");
    }
    { // TileStore.open takes its IndexedDB from the host argument at each open
      delete global.indexedDB;
      const s = await open({ indexedDB: createFakeIDB() }, "db", "tiles", { maxEntries: 3, timeoutMs: 60 });
      assert.equal(s.backend, "indexeddb", "the host's IndexedDB");
      await s.put("a", 1);
      assert.equal(await s.get("a"), 1);
      global.indexedDB = createFakeIDB(); // a global one is not the host's
      assert.equal((await open({}, "db", "tiles", { timeoutMs: 60 })).backend, "memory", "the global IndexedDB is not read");
    }
    { // pageGlobals hands both modules the window it is given, which is not globalThis here
      delete global.indexedDB;
      const calls = [];
      const win = { fetch: async (url) => { calls.push(url); return answer(200); }, navigator: { onLine: true }, indexedDB: createFakeIDB() };
      const g = pageGlobals(win);
      Overpass._reset();
      await g.Overpass.post("data=x");
      assert.equal(calls.length, 1, "the post went through the given window's fetch");
      const s = await g.TileStore.open("db", "tiles", { timeoutMs: 60 });
      assert.equal(s.backend, "indexeddb", "the given window's IndexedDB");
    }
    { // Elevation's default tile source and decoder read the given window's fetch, createImageBitmap and OffscreenCanvas, and Elevation.open its IndexedDB
      delete global.indexedDB;
      global.createImageBitmap = () => { throw new Error("read the global createImageBitmap"); };
      global.OffscreenCanvas = class { constructor() { throw new Error("read the global OffscreenCanvas"); } };
      const urls = [];
      let closed = 0;
      const win = {
        fetch: async (url) => { urls.push(url); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; },
        createImageBitmap: async () => ({ width: 1, height: 1, close() { closed++; } }),
        OffscreenCanvas: class { getContext() { return { drawImage() {}, getImageData: () => ({ width: 1, height: 1, data: [128, 130, 0, 255] }) }; } },
        indexedDB: createFakeIDB(),
      };
      const el = await pageGlobals(win).Elevation.open();
      // the tile's one pixel is r 128, g 130, b 0: 130 m
      assert.deepEqual(await el.elevationAt([[10, 10]]), [130], "decoded through the given window");
      assert.equal(urls.length, 1, "fetched through the given window");
      assert.equal(closed, 1, "the bitmap was closed");
      const again = await pageGlobals(win).Elevation.open();
      assert.deepEqual(await again.elevationAt([[10, 10]]), [130], "the tile came back from the given window's IndexedDB");
      assert.equal(urls.length, 1, "the second open read it from the store, not the network");
      const made = pageGlobals(win).Elevation.create({ store: pageGlobals(win).TileStore.memory() });
      assert.deepEqual(await made.elevationAt([[10, 10]]), [130], "create uses the given window too");
      assert.equal(urls.length, 2, "its own empty store went to the given window's fetch");
    }
    { // StreetIndex.snapPoint reads Leaflet's L from the window pageGlobals was given, when it runs; the page's StreetIndex is the module's own constructor
      const win = {};
      const g = pageGlobals(win);
      win.L = { latLng: (lat, lng) => ({ lat, lng, from: "window" }) }; // set after binding: read when snapPoint runs
      assert.equal(g.StreetIndex, global.StreetIndex, "the same constructor, not a copy");
      const idx = new g.StreetIndex({ newFrac: () => 1 });
      assert.deepEqual(idx.snapPoint({ lat: 51.0031, lng: 13.0052 }), { lat: Math.round(51.0031 / 0.006) * 0.006, lng: Math.round(13.0052 / 0.006) * 0.006, from: "window" }, "the given window's L");
      pageGlobals({});
      assert.throws(() => idx.snapPoint({ lat: 1, lng: 1 }), (e) => e instanceof ReferenceError && e.message === "L is not defined", "no L on the host is the ReferenceError a bare L gave");
    }
    { // the planner resamples a plan's waypoints with the L of the window pageGlobals was given, read when it plans; the page's constructors are the modules' own
      const win = {};
      const g = pageGlobals(win);
      win.L = { latLng: (lat, lng) => ({ lat, lng, from: "window" }) }; // set after binding
      assert.equal(g.GraphPlanner, global.GraphPlanner, "the same constructor, not a copy");
      assert.equal(g.LocalRouter, global.LocalRouter, "the same constructor, not a copy");
      const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
      const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
      const ways = [[1, 2, [0, 0], [500, 0]], [2, 3, [500, 0], [1000, 0]], [1, 4, [0, 0], [0, 200]], [4, 5, [0, 200], [1000, 200]], [5, 3, [1000, 200], [1000, 0]]];
      const streets = { ways: ways.map(([a, b, p, q]) => ({ nodes: [a, b], geometry: [ll(...p), ll(...q)] })) };
      const planner = new g.GraphPlanner(streets, (lon, lat) => ((lat - 51) * KY > 150 ? 1 : 0));
      const A = { lat: 51, lng: 13.7 }, B = { lat: 51, lng: 13.7 + 1000 / KX };
      const plans = planner.planP2P(A, B, 2000, 3);
      const between = plans[0].wps.slice(1, -1);
      assert.ok(between.length > 0 && between.every((w) => w.from === "window"), "waypoints built with the given window's L");
      { // the modules take each other through imports: with the page globals they would read swapped for decoys that throw, routing still works
        const saved = { StreetIndex: global.StreetIndex, GraphPlanner: global.GraphPlanner, LocalRouter: global.LocalRouter };
        const decoy = () => new Proxy(function () {}, { get() { throw new Error("read a page global"); }, construct() { throw new Error("read a page global"); } });
        const fail = (reason) => ({ ensureRects: async () => { throw saved.StreetIndex.downloadError(0, 1, { reason }, 0); } });
        const create = (streets) => g.RouteLocal.create({ streets, streetGraph: () => planner, elevation: { elevationAt: async () => [] }, estimates: global.Estimates });
        const warn2 = console.warn;
        console.warn = () => {};
        try {
          for (const k of Object.keys(saved)) global[k] = decoy();
          assert.deepEqual(await create(fail("superseded"))([A, B]), { error: true, why: { reason: "superseded" } });
          const failed = await create(fail("offline"))([A, B]);
          assert.equal(failed.why.reason, "streets-fetch");
          assert.equal(failed.why.download.reason, "offline");
          const routed = await create({ ensureRects: async () => ({ done: 1, total: 1 }) })([A, B]);
          assert.ok(Array.isArray(routed.coords) && routed.coords.length > 1, "routed on the module's own router and planner heap");
        } finally {
          console.warn = warn2;
          Object.assign(global, saved);
        }
      }
      pageGlobals({});
      assert.throws(() => planner.planP2P(A, B, 2000, 3), (e) => e instanceof ReferenceError && e.message === "L is not defined", "no L on the host is the ReferenceError a bare L gave");
    }
    { // the suggestion tool reads the window's L and matchMedia when it builds vias and icons; the page's SuggestTool is the module's own
      const win = {};
      const g = pageGlobals(win);
      assert.equal(g.SuggestTool, global.SuggestTool, "the same constructor, not a copy");
      const tool = new g.SuggestTool({}, { fogMap: {}, computeGain: () => null });
      const S = { lat: 51, lng: 13.7 };
      assert.throws(() => tool._loopVias(S, 0, 1000), (e) => e instanceof ReferenceError && e.message === "L is not defined", "no L on the host is the ReferenceError a bare L gave");
      win.L = { latLng: (lat, lng) => ({ lat, lng, from: "window" }), divIcon: (o) => ({ ...o, from: "window" }) }; // set after binding
      const vias = tool._loopVias(S, 0, 1000);
      assert.ok(vias.length === 3 && vias.every((v) => v.from === "window"), "vias built with the given window's L");
      win.matchMedia = (q) => ({ matches: q === "(pointer: coarse)" });
      win.L.marker = (ll, o) => ({ ll, o, addTo() { return this; }, on() {} });
      const marker = (() => { const t2 = new g.SuggestTool({ on() {}, off() {} }, { fogMap: {}, computeGain: () => null }); t2.map = { addLayer() {}, removeLayer() {} }; t2._place(S); return t2.a; })();
      assert.equal(marker.o.icon.iconSize[0], 26, "a coarse pointer from the window's matchMedia gets the larger pin");
      { // every Leaflet read goes through the window's L: with the global L swapped for a decoy that throws, the places that build points, lines and bounds still work
        const stub = global.L;
        const fromWin = (o) => ({ ...o, from: "window" });
        const stopped = [], clicks = {};
        win.L = {
          latLng: (lat, lng) => fromWin({ lat, lng }),
          polyline: (pts, o) => fromWin({ pts, o, addTo() { return this; }, setStyle() {}, bringToFront() {} }),
          latLngBounds: () => fromWin({ extend() { return this; } }),
          divIcon: (o) => fromWin(o),
          marker: (ll, o) => fromWin({ ll, o, addTo() { return this; }, on(type, fn) { clicks[type] = fn; } }),
          DomEvent: { stop: (e) => stopped.push(e) },
        };
        global.L = new Proxy({}, { get() { throw new Error("read the global L"); } });
        try {
          const KX2 = 111320 * Math.cos(51 * Math.PI / 180);
          const S2 = { lat: 51, lng: 13.7 };
          const streets2 = { covered: () => true, newAreaM2: (ll) => (ll.from === "window" ? 20000 : 5000), ways: [], version: 0, newFrac: () => 1 };
          const t4 = new g.SuggestTool({ addLayer() {}, removeLayer() {}, fitBounds() {} }, { fogMap: new g.FogParser.FogMap(), computeGain: () => ({ area: 1, newPct: 1 }), streets: streets2 });
          t4.a = { getLatLng: () => S2 };
          t4.b = { getLatLng: () => ({ lat: 51, lng: 13.7 + 1000 / KX2 }) };
          assert.equal(t4._viaPoint(0.5, 1, 100).from, "window", "_viaPoint");
          assert.equal(t4._loopViasTri(S2, 0, 300)[0].from, "window", "_loopViasTri");
          assert.ok(t4._loopBearings(S2, 5000).length > 0, "_loopBearings runs with only the window's L: the global one throws on a read");
          assert.equal(t4._snapToNewStreets(S2, 600).from, "window", "_snapToNewStreets moves to a point built with the window's L");
          const joined = g.SuggestTool._internals.joinPins({ legs: [{ coords: [[13.7, 51]] }, { coords: [] }] }, S2, S2);
          assert.equal(joined[1].from, "window", "joinPins");
          // a finished run draws its lines and fits the map to them with the window's L
          t4.select = () => {};
          let drawn = null;
          t4.onResults = (s) => { drawn = s; };
          t4.mode = "loop";
          t4._runId = 1;
          t4._finish(1, [{ r: { coords: [[13.7, 51], [13.71, 51]], lenM: 700 }, adoptWps: [] }], { targetKm: 1 });
          assert.ok(drawn && t4.lines.length > 0 && t4.lines.every((l) => l.solid.from === "window" && l.dashed.from === "window"), "_finish draws with the window's L");
          // clicking a pin removes it, and stops the click with the window's DomEvent
          const t5 = new g.SuggestTool({ addLayer() {}, removeLayer() {} }, { fogMap: new g.FogParser.FogMap(), computeGain: () => null });
          t5._place(S2);
          assert.ok(t5.a, "pin placed");
          const ev = {};
          clicks.click(ev);
          assert.deepEqual(stopped, [ev], "DomEvent.stop is the window's");
          assert.equal(t5.a, null, "the click removed the pin");
          // a whole A-to-B run over a small street map builds its midpoint and via points with the window's L
          const ll2 = (x, y) => ({ lat: 51 + y / 110540, lon: 13.7 + x / KX2 });
          const real = new g.StreetIndex({ newFrac: () => 1 });
          real._anchor(51);
          for (const [id, nodes, p, q] of [[1, [1, 2], [0, 0], [500, 0]], [2, [2, 3], [500, 0], [1000, 0]], [3, [1, 4], [0, 0], [0, 300]], [4, [4, 3], [0, 300], [1000, 0]]]) real._addWay({ id, nodes, geometry: [ll2(...p), ll2(...q)] });
          real._cover(g.StreetIndex.tilesCovering({ s: 50.9, n: 51.1, w: 13.6, e: 13.8 }), "run");
          const t6 = new g.SuggestTool(global.fakeMap(), { fogMap: { tileCount: 0, hasFog: () => false }, computeGain: () => ({ area: 1, newPct: 1 }), streets: real });
          t6.mode = "p2p";
          const at2 = (x, y) => { const pt = win.L.latLng(51 + y / 110540, 13.7 + x / KX2); return { getLatLng: () => pt }; };
          t6.a = at2(0, 0);
          t6.b = at2(1000, 0);
          await t6.suggest({ buffer: 0.15 });
          assert.ok(t6.results.length > 0 && t6.lines.every((l) => l.solid.from === "window"), "a whole run draws with the window's L");
        } finally {
          global.L = stub;
        }
      }
      { // the tool takes the other modules through imports: with the page globals it would read swapped for decoys that throw, it still works
        const names = ["FogGain", "FogParser", "Estimates", "StreetIndex", "GraphPlanner", "LocalRouter"];
        const saved = Object.fromEntries(names.map((k) => [k, global[k]]));
        const decoy = () => new Proxy(function () {}, { get() { throw new Error("read a page global"); }, construct() { throw new Error("read a page global"); } });
        const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
        const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
        const ways = [[1, 2, [0, 0], [500, 0]], [2, 3, [500, 0], [1000, 0]]];
        const streets = { version: 0, newFrac: () => 1, ways: ways.map(([a2, b2, p, q], i) => ({ id: i, nodes: [a2, b2], geometry: [ll(...p), ll(...q)] })) };
        const t3 = new g.SuggestTool({}, { fogMap: new g.FogParser.FogMap(), computeGain: () => null, streets });
        const warn3 = console.warn, error3 = console.error;
        console.warn = () => {};
        console.error = () => {};
        try {
          for (const k of names) global[k] = decoy();
          assert.equal(typeof t3._newness({ lat: 51, lng: 13.7 }), "number", "FogGain through its import");
          const st = g.SuggestTool._internals.statsFromCoords([[13.7, 51, 100], [13.71, 51, 130]]);
          assert.ok(st.lenM > 0 && st.ascent !== undefined, "Estimates.climb through its import");
          const route = await t3._route([{ lat: 51, lng: 13.7 }, { lat: 51, lng: 13.7 + 1000 / KX }], {});
          assert.ok(route && route.coords.length > 1, "GraphPlanner and LocalRouter through their imports");
          const why = t3._noRoute([{ lat: 51, lng: 13.7 }, { lat: 60, lng: 14 }]);
          assert.ok(why && typeof why.reason === "string", "LocalRouter.explain through its import, for a pin off the network");
          const failWith = (reason) => ({ ensureRects: async () => { throw saved.StreetIndex.downloadError(0, 1, { reason }, 0); } });
          const load = async (reason) => { const out = []; t3.streets = failWith(reason); const ok = await t3._loadStreets([], (m) => out.push(m), () => false); return { ok, out }; };
          assert.deepEqual(await load("superseded"), { ok: false, out: [] });
          const off = await load("offline");
          assert.ok(off.out.length === 1 && off.out[0].reason === "streets-fetch" && off.out[0].download.reason === "offline", "StreetIndex statics through the import");
        } finally {
          console.warn = warn3;
          console.error = error3;
          Object.assign(global, saved);
        }
      }
    }
  } finally {
    console.warn = warn;
    delete global.createImageBitmap;
    delete global.OffscreenCanvas;
    global.fetch = realFetch;
    if (realIdb) global.indexedDB = realIdb; else delete global.indexedDB;
    if (hadNavigator) Object.defineProperty(global, "navigator", hadNavigator); else delete global.navigator;
    delete global.crossfogNextgisKey;
    bindOverpassHost(globalThis);
    bindStreetsHost(globalThis);
    bindPlannerHost(globalThis);
    bindSuggestHost(globalThis);
    Overpass._reset();
  }
  console.log("engine-host.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
