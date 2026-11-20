// StreetCache: cache-first street source over a TileStore; fake network that records its calls.
//   node bench/street-cache.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { TileStore, StreetCache, StreetIndex } = global;
const { heldAround } = require("./lib/held.js");

const DAY = 24 * 3600 * 1000;
const answerFor = (t) => ({ ways: [{ id: t.x * 1000 + t.y, nodes: [1, 2], geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }], groups: { tag: "net" } });
function fakeNetwork() {
  const calls = [];
  const network = async (tiles, onTile) => {
    calls.push({ tiles });
    const out = new Map();
    for (const t of tiles) {
      out.set(t.x + ":" + t.y, answerFor(t));
      if (onTile) onTile(t, out.get(t.x + ":" + t.y));
    }
    return out;
  };
  return { network, calls };
}
const T = (x, y) => ({ x, y });

(async () => {
  { // the network hears the run's options, so a busy wait keeps to the run's clock and stop
    const seen = [];
    const network = async (tiles, onTile, opts) => { seen.push(opts); return new Map(tiles.map((t) => [t.x + ":" + t.y, answerFor(t)])); };
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => 0 });
    const waits = [];
    const opts = { now: () => 7, wait: async (until) => { waits.push(until); return true; } };
    await c.fetchStreets([T(1, 2)], null, opts);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].now(), 7);
    assert.equal(await seen[0].wait(15000), true);
    assert.deepEqual(waits, [15000]);
  }
  { // the caller stopping the run during a busy wait is its stop: no expired copy stands in for the rest
    let t = 0;
    const store = TileStore.memory({ maxEntries: 10 });
    const { network } = fakeNetwork();
    const c = StreetCache.create({ store, network, now: () => t, maxAgeMs: DAY });
    await c.fetchStreets([T(1, 2)]);
    t = 2 * DAY;
    const stop = Object.assign(new Error("replaced"), { reason: "superseded" });
    const waiting = async (tiles, onTile, opts) => { await opts.wait(t + 15000); throw new Error("not reached"); };
    const c2 = StreetCache.create({ store, network: waiting, now: () => t, maxAgeMs: DAY });
    const got = await c2.fetchStreets([T(1, 2)], null, { now: () => t, wait: async () => { throw stop; } }).then(() => null, (e) => e);
    assert.equal(got, stop);
  }
  { // a replaced run is told to the network (its posts waiting for a slot are then not sent), and its
    // outage gets no expired copy in place of the rest: nothing would use them
    let t = 0;
    const store = TileStore.memory({ maxEntries: 10 });
    const { network } = fakeNetwork();
    const c = StreetCache.create({ store, network, now: () => t, maxAgeMs: DAY });
    await c.fetchStreets([T(1, 2)]);
    t = 2 * DAY;
    let stale = false, heard = null;
    const failing = async (tiles, onTile, opts) => {
      heard = opts.stale;
      stale = true;
      throw Object.assign(new Error("overpass HTTP 502"), { reason: "busy" });
    };
    const c2 = StreetCache.create({ store, network: failing, now: () => t, maxAgeMs: DAY });
    const got = await c2.fetchStreets([T(1, 2)], null, { now: () => t, wait: async () => true, stale: () => stale }).then(() => null, (e) => e);
    assert.equal(typeof heard, "function");
    assert.equal(heard(), true, "the network hears the caller's own stale");
    assert.equal(got && got.reason, "busy");
  }
  { // a cold request fetches and stores; the same request again makes no network call
    const { network, calls } = fakeNetwork();
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => 0 });
    const first = await c.fetchStreets([T(1, 2)]);
    const again = await c.fetchStreets([T(1, 2)]);
    assert.equal(calls.length, 1);
    assert.deepEqual(again.get("1:2"), first.get("1:2"));
    assert.deepEqual(first.get("1:2"), answerFor(T(1, 2)));
  }
  { // three tiles with two cached: only the third goes out, and the union comes back
    const { network, calls } = fakeNetwork();
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => 0 });
    await c.fetchStreets([T(1, 1), T(2, 1)]);
    const got = await c.fetchStreets([T(1, 1), T(2, 1), T(3, 1)]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].tiles, [T(3, 1)]);
    assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1", "3:1"]);
  }
  { // a tile older than maxAgeMs is refetched, a younger one is not
    const { network, calls } = fakeNetwork();
    let t = 0;
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => t, maxAgeMs: 90 * DAY });
    await c.fetchStreets([T(1, 1)]);
    t = 89 * DAY;
    await c.fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 1);
    t = 91 * DAY;
    await c.fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 2);
  }
  { // a phone's existing cache keeps serving: an entry stored under "4:run:" is read, fresh or expired, and
    // one under the removed "2:bike:" kind never is (LRU eviction takes it); a new answer is stored under "4:run:"
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("4:run:1:1", { answer: { ways: [], groups: { tag: "run" } }, fetchedAt: 0 });
    await store.put("2:bike:2:1", { answer: { ways: [], groups: { tag: "bike" } }, fetchedAt: 0 });
    await store.put("4:run:3:1", { answer: { ways: [], groups: { tag: "run" } }, fetchedAt: -100 * DAY });
    const offline = async () => { throw Object.assign(new Error("offline"), { reason: "offline" }); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const old = await StreetCache.create({ store, network: offline, now: () => 0 }).fetchStreets([T(3, 1)]);
      assert.equal(old.get("3:1").groups.tag, "run", "an expired run entry still serves offline");
    } finally { console.warn = warn; }
    const c = StreetCache.create({ store, network, now: () => 0 });
    const got = await c.fetchStreets([T(1, 1), T(2, 1)]);
    assert.deepEqual(calls.map((x) => x.tiles), [[T(2, 1)]], "the run entry needs no request, the bike one does");
    assert.equal(got.get("2:1").groups.tag, "net");
    assert.equal((await store.get("4:run:2:1")).answer.groups.tag, "net");
    assert.equal((await store.get("2:bike:2:1")).answer.groups.tag, "bike", "left for LRU eviction");
  }
  { // answers stored under "2:run:" carry the id lists of the removed travel modes: they are never read, so
    // none is mixed with a one-list answer; the network is asked and the new answer goes under "4:run:"
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("2:run:1:1", { answer: { ways: [], groups: { bike: [1], motorway: [] } }, fetchedAt: 0 });
    const got = await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1)]);
    assert.deepEqual(calls.map((x) => x.tiles), [[T(1, 1)]]);
    assert.equal(got.get("1:1").groups.tag, "net");
    assert.ok(await store.get("4:run:1:1"), "the new answer is stored under the new version");
    assert.ok(await store.get("2:run:1:1"), "the old entry is left for LRU eviction");
  }
  { // answers stored under "3:run:" came from the query that also asked for the motorway list: they are never
    // read, fresh or expired, so a phone's old answers are not mixed in; the new answer goes under "4:run:"
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("3:run:1:1", { answer: { ways: [], groups: { motorway: [] } }, fetchedAt: 0 });
    await store.put("3:run:2:1", { answer: { ways: [], groups: { motorway: [] } }, fetchedAt: -100 * DAY });
    const got = await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1), T(2, 1)]);
    assert.deepEqual(calls.map((x) => x.tiles), [[T(1, 1), T(2, 1)]], "both tiles are asked");
    assert.equal(got.get("1:1").groups.tag, "net");
    assert.ok(await store.get("4:run:1:1") && await store.get("4:run:2:1"), "the new answers are stored under the new version");
    assert.ok(await store.get("3:run:1:1"), "the old entry is left for LRU eviction");
    // an expired "3:" entry does not serve offline either
    const offline = async () => { throw Object.assign(new Error("offline"), { reason: "offline" }); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const fresh = TileStore.memory({ maxEntries: 10 });
      await fresh.put("3:run:5:5", { answer: { ways: [], groups: { motorway: [] } }, fetchedAt: -100 * DAY });
      const err = await StreetCache.create({ store: fresh, network: offline, now: () => 0 }).fetchStreets([T(5, 5)]).then(() => null, (e) => e);
      assert.equal(err && err.reason, "offline", "the old entry is no copy to fall back on");
    } finally { console.warn = warn; }
  }
  { // a store whose get throws still returns the network answer, and asks the network for every tile
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.get = async () => { throw new Error("idb dead"); };
    const c = StreetCache.create({ store, network, now: () => 0 });
    const got = await c.fetchStreets([T(1, 1), T(2, 1)]);
    assert.equal(calls.length, 1);
    assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1"]);
  }
  { // a store whose put throws does not fail the request
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.put = async () => { throw new Error("quota"); };
    const c = StreetCache.create({ store, network, now: () => 0 });
    const got = await c.fetchStreets([T(1, 1)]);
    assert.ok(got.get("1:1"));
  }
  { // a damaged entry counts as a miss
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("4:run:1:1", { junk: true });
    const c = StreetCache.create({ store, network, now: () => 0 });
    await c.fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 1);
  }
  { // a network failure is an error, unless every missing tile has an expired copy: then those serve
    let fail = false;
    const base = fakeNetwork();
    const network = async (tiles) => { if (fail) throw Object.assign(new Error("offline"), { reason: "offline" }); return base.network(tiles); };
    let t = 0;
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => t, maxAgeMs: 90 * DAY });
    await c.fetchStreets([T(1, 1)]);
    t = 200 * DAY; fail = true;
    const got = await c.fetchStreets([T(1, 1)]);
    assert.deepEqual(got.get("1:1"), answerFor(T(1, 1)), "expired copy serves offline");
    await assert.rejects(() => c.fetchStreets([T(1, 1), T(9, 9)]), /offline/);
  }
  { // end to end with StreetIndex: a second index over the same store never touches the network
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const rect = [{ s: 51, w: 13.7, n: 51.01, e: 13.71 }];
    const a = new StreetIndex({ newFrac: () => 1, fetchStreets: StreetCache.create({ store, network, now: () => 0 }).fetchStreets });
    await a.ensureRects(rect);
    const b = new StreetIndex({ newFrac: () => 1, fetchStreets: StreetCache.create({ store, network, now: () => 0 }).fetchStreets });
    await b.ensureRects(rect);
    assert.equal(calls.length, 1);
    assert.equal(b.ways.length, a.ways.length);
  }
  { // one dead store costs one failed read for the whole call, not one per tile
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    let gets = 0;
    store.get = async () => { gets++; throw new Error("idb dead"); };
    await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1), T(2, 1), T(3, 1)]);
    assert.equal(gets, 1);
  }
  { // a network answer missing a tile comes back as it is, and only the tiles it holds are stored
    const base = fakeNetwork();
    const network = async (tiles) => { const m = await base.network(tiles); m.delete("2:1"); return m; }; // no onTile: the Map alone
    const store = TileStore.memory({ maxEntries: 10 });
    const got = await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1), T(2, 1)]);
    assert.deepEqual([...got.keys()], ["1:1"]);
    assert.deepEqual(await store.keys(), ["4:run:1:1"]);
  }
  { // the cache is installed on an index that already exists, as main.js does once the store opens
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const warm = StreetCache.create({ store, network, now: () => 0 });
    await warm.fetchStreets(StreetIndex.tilesCovering({ s: 51, w: 13.7, n: 51.01, e: 13.71 }));
    const idx = new StreetIndex({ newFrac: () => 1, fetchStreets: network });
    idx.fetchStreets = warm.fetchStreets;
    await idx.ensureRects([{ s: 51, w: 13.7, n: 51.01, e: 13.71 }]);
    assert.equal(calls.length, 1, "the swapped-in cache answered");
  }
  { // entries of the wrong shape, or stamped in the future, are refetched and overwritten
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("4:run:1:1", { answer: { ways: "x", groups: {} }, fetchedAt: 0 });
    await store.put("4:run:2:1", { answer: { ways: [], groups: {} }, fetchedAt: 5000 });
    const c = StreetCache.create({ store, network, now: () => 0 });
    await c.fetchStreets([T(1, 1), T(2, 1)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tiles.length, 2);
    assert.deepEqual((await store.get("4:run:1:1")).answer, answerFor(T(1, 1)));
    assert.deepEqual((await store.get("4:run:2:1")).answer, answerFor(T(2, 1)));
  }
  { // tiles that arrived before the network failed are stored and handed on; the error is the network's own, counted by ensureRects
    const base = fakeNetwork();
    const network = async (tiles, onTile) => {
      await base.network(tiles.slice(0, 1), onTile);
      throw Object.assign(new Error("overpass HTTP 502"), { reason: "busy" });
    };
    const store = TileStore.memory({ maxEntries: 10 });
    await StreetCache.create({ store, network: base.network, now: () => 0 }).fetchStreets([T(0, 0)]);
    const seen = [];
    const err = await StreetCache.create({ store, network, now: () => 0 })
      .fetchStreets([T(0, 0), T(1, 1), T(2, 1)], (t) => seen.push(t.x + ":" + t.y)).then(() => null, (e) => e);
    assert.deepEqual(seen, ["0:0", "1:1"], "the cached tile, then the one that arrived");
    assert.deepEqual((await store.keys()).sort(), ["4:run:0:0", "4:run:1:1"]);
    assert.deepEqual([err.message, err.reason], ["overpass HTTP 502", "busy"]);
  }
  { // an unversioned key is never read, so no answer is served for a tile of another grid
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("run:1:1", { answer: { ways: [], groups: {} }, fetchedAt: 0 });
    await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 1);
    assert.ok(await store.get("4:run:1:1"), "the answer is stored under the versioned key");
  }
  { // onTile hears every tile once, cached ones first, then each network tile as it arrives
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const c = StreetCache.create({ store, network, now: () => 0 });
    await c.fetchStreets([T(2, 1)]);
    const seen = [];
    const got = await c.fetchStreets([T(1, 1), T(2, 1), T(3, 1)], (t, answer) => seen.push([t.x + ":" + t.y, answer.ways[0].id]));
    assert.deepEqual(seen, [["2:1", 2001], ["1:1", 1001], ["3:1", 3001]]);
    assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1", "3:1"]);
  }
  { // offline after some tiles arrived: the rest serve from expired copies when every one of them has one,
    // in the returned Map only, so a caller's stop on each tile (the run deadline) cannot cut them off
    let t = 0;
    const base = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const c = StreetCache.create({ store, network: base.network, now: () => t, maxAgeMs: 90 * DAY });
    await c.fetchStreets([T(2, 1)]);
    t = 200 * DAY;
    const network = async (tiles, onTile) => { await base.network(tiles.slice(0, 1), onTile); throw Object.assign(new Error("offline"), { reason: "offline" }); };
    const seen = [];
    const got = await StreetCache.create({ store, network, now: () => t, maxAgeMs: 90 * DAY })
      .fetchStreets([T(1, 1), T(2, 1)], (tile) => seen.push(tile.x + ":" + tile.y));
    assert.deepEqual(seen, ["1:1"]);
    assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1"]);
    assert.equal((await store.get("4:run:2:1")).fetchedAt, 0, "the expired copy is served, not restamped");
  }
  { // a caller that stops the run (its onTile throws) gets no expired copies in its place
    let t = 0;
    const base = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await StreetCache.create({ store, network: base.network, now: () => t }).fetchStreets([T(2, 1)]);
    t = 200 * DAY;
    const stop = Object.assign(new Error("deadline"), { reason: "stalled" });
    const err = await StreetCache.create({ store, network: base.network, now: () => t, maxAgeMs: 90 * DAY })
      .fetchStreets([T(1, 1), T(2, 1)], () => { throw stop; }).then(() => null, (e) => e);
    assert.equal(err, stop, "the stop is the rejection");
    assert.equal(base.calls[1].tiles.length, 2);
  }
  { // a bug in the caller's onTile comes back as itself, with no expired copies in its place
    let t = 0;
    const base = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await StreetCache.create({ store, network: base.network, now: () => t }).fetchStreets([T(1, 1), T(2, 1)]);
    t = 200 * DAY;
    const bug = new TypeError("bug");
    const err = await StreetCache.create({ store, network: base.network, now: () => t, maxAgeMs: 90 * DAY })
      .fetchStreets([T(1, 1), T(2, 1)], () => { throw bug; }).then(() => null, (e) => e);
    assert.equal(err, bug);
  }
  { // a bug thrown by the network source is not an outage: no expired copy stands in for it
    let t = 0;
    const base = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await StreetCache.create({ store, network: base.network, now: () => t }).fetchStreets([T(1, 1), T(2, 1)]);
    t = 200 * DAY;
    const bug = new TypeError("bug");
    const network = async () => { throw bug; };
    const err = await StreetCache.create({ store, network, now: () => t, maxAgeMs: 90 * DAY })
      .fetchStreets([T(1, 1), T(2, 1)]).then(() => null, (e) => e);
    assert.equal(err, bug);
    // a download error from the default source (streets-partial) is an outage like the others
    const partial = Object.assign(new Error("got 1 of 2"), { reason: "streets-partial" });
    const got = await StreetCache.create({ store, network: async () => { throw partial; }, now: () => t, maxAgeMs: 90 * DAY })
      .fetchStreets([T(1, 1), T(2, 1)]);
    assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1"]);
  }
  { // a failed store write is logged once per cache, by the error's name alone
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.put = async () => { throw new DOMException("quota", "QuotaExceededError"); };
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a);
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1)]);
      await c.fetchStreets([T(2, 1)]);
    } finally { console.warn = warn; }
    assert.deepEqual(warned, [["[streets] cache write failed", "QuotaExceededError"]]);
  }
  { // a failed store read is logged once per cache, by the error's name alone (no write is tried after it)
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.get = async () => { throw new DOMException("idb dead", "InvalidStateError"); };
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a);
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1)]);
      await c.fetchStreets([T(2, 1)]);
    } finally { console.warn = warn; }
    assert.deepEqual(warned, [["[streets] cache read failed", "InvalidStateError"]]);
  }
  { // the run deadline passes while the request fails and every tile has an expired copy: the run still
    // gets every tile, since expired copies cost no request
    let t = 0;
    const clock = { t: 0 };
    const rect = { s: 51.0, w: 13.7, n: 51.025, e: 13.775 };
    const tiles = StreetIndex.tilesCovering(rect);
    assert.equal(tiles.length, 3);
    const store = TileStore.memory({ maxEntries: 10 });
    for (const tile of tiles) await store.put("4:run:" + tile.x + ":" + tile.y, { answer: answerFor(tile), fetchedAt: 0 });
    t = 200 * DAY;
    const network = async () => { clock.t += 80000; throw Object.assign(new Error("overpass: no answer"), { reason: "stalled" }); };
    const c = StreetCache.create({ store, network, now: () => t, maxAgeMs: 90 * DAY });
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: c.fetchStreets, now: () => clock.t });
    const progress = [];
    await s.ensureRects([rect], { onProgress: (p) => progress.push(p.done) });
    assert.equal(heldAround(s, [rect]).length, 3);
    assert.deepEqual(progress, [0, 1, 2, 3]);
  }
  { // the old unversioned keys are swept in the background, a bounded number per call, and the new ones stay
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 1000 });
    await store.put("run:1:1", { junk: 1 });
    await store.put("bike:2:2", { junk: 2 });
    await store.put("4:run:9:9", { newer: true });
    await store.put("2:run:1:1", { answer: answerFor(T(1, 1)), fetchedAt: 0 });
    const c = StreetCache.create({ store, network, now: () => 0 });
    assert.equal((await store.keys()).length, 4, "creating the cache sweeps nothing: opening the store is never held up");
    assert.equal(await c.sweepLegacy(), 2);
    assert.deepEqual((await store.keys()).sort(), ["2:run:1:1", "4:run:9:9"], "a versioned entry stays");
    for (let i = 0; i < 300; i++) await store.put("run:" + i + ":0", i);
    assert.equal(await c.sweepLegacy(), 256, "bounded: the rest waits for the next open");
    assert.equal((await store.keys()).length, 2 + 44);
    const dead = TileStore.memory({ maxEntries: 10 });
    dead.keys = async () => { throw new Error("idb dead"); };
    assert.equal(await StreetCache.create({ store: dead, network, now: () => 0 }).sweepLegacy(), 0, "a store that fails costs nothing");
  }
  { // a stored answer with damaged ways or groups is a miss and is removed, not served to fail every run in the area
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("4:run:1:1", { answer: { ways: [null], groups: {} }, fetchedAt: 0 });
    await store.put("4:run:2:1", { answer: { ways: [], groups: { a: 5 } }, fetchedAt: 0 });
    const c = StreetCache.create({ store, network, now: () => 0 });
    const got = await c.fetchStreets([T(1, 1), T(2, 1)]);
    assert.deepEqual(calls.map((x) => x.tiles), [[T(1, 1), T(2, 1)]], "both are asked for again");
    assert.deepEqual([got.get("1:1").groups.tag, got.get("2:1").groups.tag], ["net", "net"]);
    assert.deepEqual([(await store.get("4:run:1:1")).answer.groups.tag, (await store.get("4:run:2:1")).answer.groups.tag], ["net", "net"], "both damaged entries are replaced");
  }
  { // the default age limit is 90 days: a tile 90 days old is refetched, one a millisecond younger is not
    const { network, calls } = fakeNetwork();
    let t = 0;
    const c = StreetCache.create({ store: TileStore.memory({ maxEntries: 10 }), network, now: () => t });
    await c.fetchStreets([T(1, 1)]);
    t = 90 * DAY - 1;
    await c.fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 1);
    t = 90 * DAY;
    await c.fetchStreets([T(1, 1)]);
    assert.equal(calls.length, 2);
  }
  { // an expired copy served offline says so
    const store = TileStore.memory({ maxEntries: 10 });
    await store.put("4:run:2:1", { answer: { ways: [], groups: { tag: "run" } }, fetchedAt: 0 });
    const offline = async () => { throw Object.assign(new Error("offline"), { reason: "offline" }); };
    const c = StreetCache.create({ store, network: offline, now: () => 120 * DAY });
    const warned = [];
    const warn = console.warn; console.warn = (...a) => warned.push(a.join(" "));
    let old;
    try { old = await c.fetchStreets([T(2, 1)]); } finally { console.warn = warn; }
    assert.equal(old.get("2:1").groups.tag, "run");
    assert.deepEqual(warned, ["[streets] offline: serving 1 expired tile(s) from the cache (offline)"], "the fallback says so: a count and the reason, no tile data");
  }
  { // the tile whose onTile stops the run is stored first: the put runs before the delivery
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const stop = new Error("stop");
    const err = await StreetCache.create({ store, network, now: () => 0 })
      .fetchStreets([T(1, 1), T(2, 1)], () => { throw stop; }).then(() => null, (e) => e);
    assert.equal(err, stop);
    assert.deepEqual(await store.keys(), ["4:run:1:1"], "the tile that triggered the stop is kept");
  }
  { // a source that calls onTile and also returns its Map: each tile is delivered once, stored once, and counted once by the index
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const puts = [];
    const put = store.put;
    store.put = (k, v) => { puts.push(k); return put.call(store, k, v); };
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: StreetCache.create({ store, network, now: () => 0 }).fetchStreets });
    const reports = [];
    const rect = [{ s: 51, w: 13.7, n: 51.02, e: 13.76 }];
    const got = await s.ensureRects(rect, { onProgress: (p) => reports.push(p.done) });
    assert.equal(heldAround(s, rect).length, got.total);
    assert.equal(s.version, got.total, "one version bump per tile");
    assert.deepEqual(reports, Array.from({ length: got.total + 1 }, (_, i) => i), "done never above total, each tile once");
    assert.equal(new Set(puts).size, puts.length, "no tile stored twice");
    assert.equal(puts.length, got.total);
  }
  { // the first put rejects: the other tiles are still delivered, and no further put is tried
    const base = fakeNetwork();
    // tiles arrive one turn apart, as they do off the network: the first put has failed by the next tile
    const network = async (tiles, onTile) => {
      for (const t of tiles) { await new Promise((r) => setImmediate(r)); await base.network([t], onTile); }
      return new Map();
    };
    const store = TileStore.memory({ maxEntries: 10 });
    let puts = 0;
    store.put = async () => { puts++; throw new Error("quota"); };
    const seen = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
      const got = await StreetCache.create({ store, network, now: () => 0 })
        .fetchStreets([T(1, 1), T(2, 1), T(3, 1)], (t) => seen.push(t.x));
      assert.deepEqual(seen, [1, 2, 3]);
      assert.deepEqual([...got.keys()].sort(), ["1:1", "2:1", "3:1"]);
    } finally { console.warn = warn; }
    assert.equal(puts, 1, "storeDown: no put after the first failed");
  }
  { // the cache name prefix is the tile grid's version: changing TILE_DEG (or the prefix) without the other fails here
    assert.equal(StreetIndex.TILE_DEG, 0.025, "TILE_DEG changed: bump the version prefix of the cache names in streetCache.ts and update this pair");
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    await StreetCache.create({ store, network, now: () => 0 }).fetchStreets([T(1, 1)]);
    assert.deepEqual(await store.keys(), ["4:run:1:1"], "the prefix that goes with a 0.025 grid");
  }
  { // STREET_REASONS (streetDownload.ts) and OUTAGE_REASONS (streetCache.ts) are not exported, and streetCache.ts keeps its own list:
    // the outage list is the street reasons minus superseded, plus streets-partial
    const fs = require("fs"), path = require("path");
    const listOf = (file, name) => {
      const text = fs.readFileSync(path.join(__dirname, "..", "app", "src", file), "utf8");
      const m = text.match(new RegExp("const " + name + " = new Set\\(\\[([^\\]]*)\\]\\)"));
      assert.ok(m, name + " not found in " + file);
      return m[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
    };
    const street = listOf("streetDownload.ts", "STREET_REASONS"), outage = listOf("streetCache.ts", "OUTAGE_REASONS");
    assert.deepEqual(outage.slice().sort(), street.filter((r) => r !== "superseded").concat("streets-partial").sort());
  }
  { // three calls in a row with a failing store, then the store is not asked again; the network still answers
    const { network, calls } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.backend = "indexeddb";
    let gets = 0, puts = 0;
    store.get = async () => { gets++; throw new Error("hung"); };
    store.put = async () => { puts++; };
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a);
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      for (let i = 1; i <= 3; i++) await c.fetchStreets([T(i, 1)]);
      assert.equal(gets, 3);
      const seen = [];
      const got = await c.fetchStreets([T(4, 1), T(5, 1)], (t) => seen.push(t.x + ":" + t.y));
      assert.equal(gets, 3, "no store read once the store is skipped");
      assert.equal(puts, 0, "no store write either");
      assert.deepEqual(seen, ["4:1", "5:1"], "network answers still reach onTile");
      assert.deepEqual([...got.keys()], ["4:1", "5:1"], "and the returned Map");
      assert.equal(calls.length, 4);
      await c.fetchStreets([T(6, 1)]);
      assert.equal(gets, 3);
    } finally { console.warn = warn; }
    const skips = warned.filter((w) => /skipped/.test(w[0]));
    assert.equal(skips.length, 1, "one line says so");
    assert.deepEqual(skips[0], ["[streets] cache store skipped for this session after 3 failed calls (indexeddb)"]);
  }
  { // a call that gets through the store in between resets the count
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    const realGet = store.get.bind(store);
    let down = true, gets = 0;
    store.get = async (k) => { gets++; if (down) throw new Error("hung"); return realGet(k); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1)]);
      await c.fetchStreets([T(2, 1)]);
      down = false;
      await c.fetchStreets([T(3, 1)]);
      down = true;
      await c.fetchStreets([T(4, 1)]);
      await c.fetchStreets([T(5, 1)]);
      const before = gets;
      await c.fetchStreets([T(6, 1)]);
      assert.equal(gets, before + 1, "two failures after the success: the store is still asked");
      await c.fetchStreets([T(7, 1)]);
      assert.equal(gets, before + 1, "the third in a row skips it");
    } finally { console.warn = warn; }
  }
  { // a put that fails counts as a failed call too, and a call with several failing puts counts once
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    let puts = 0;
    store.put = async () => { puts++; throw new Error("hung"); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1), T(2, 1)]);
      await c.fetchStreets([T(3, 1)]);
      const before = puts;
      await c.fetchStreets([T(4, 1)]);
      assert.equal(puts, before + 1, "two calls so far with a failed put (not three): still written");
      await c.fetchStreets([T(5, 1)]);
      assert.equal(puts, before + 1, "after the third failed call, no more writes");
    } finally { console.warn = warn; }
  }
  { // once the store is skipped there is nothing to read: an outage rethrows, expired copies are not served
    let t = 0;
    const store = TileStore.memory({ maxEntries: 10 });
    const { network } = fakeNetwork();
    await StreetCache.create({ store, network, now: () => t, maxAgeMs: DAY }).fetchStreets([T(9, 9)]);
    t = 2 * DAY; // the stored copy of 9:9 is now expired
    const realGet = store.get.bind(store);
    let down = true;
    store.get = async (k) => { if (down) throw new Error("hung"); return realGet(k); };
    const outage = Object.assign(new Error("busy"), { reason: "busy" });
    const failing = async () => { throw outage; };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const c = StreetCache.create({ store, network: failing, now: () => t, maxAgeMs: DAY });
      for (let i = 1; i <= 3; i++) await c.fetchStreets([T(i, 1)]).then(() => assert.fail("no answer"), (e) => assert.equal(e, outage));
      down = false; // the store would answer now, but it is skipped for the session
      const got = await c.fetchStreets([T(9, 9)]).then(() => null, (e) => e);
      assert.equal(got, outage, "the outage error rethrows as it does today");
    } finally { console.warn = warn; }
  }
  { // a call stopped by the caller's onTile still has its writes counted (the network hands tiles over in its Map alone)
    const store = TileStore.memory({ maxEntries: 10 });
    let gets = 0;
    const realGet = store.get.bind(store);
    store.get = async (k) => { gets++; return realGet(k); };
    store.put = () => new Promise((_, reject) => setTimeout(() => reject(new Error("hung")), 5));
    const network = async (tiles) => new Map(tiles.map((t) => [t.x + ":" + t.y, answerFor(t)]));
    const stop = () => { throw new Error("stop"); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      for (let i = 1; i <= 3; i++) await c.fetchStreets([T(i, 1)], stop).then(() => assert.fail("stopped"), (e) => assert.equal(e.message, "stop"));
      await c.fetchStreets([T(4, 1)]);
      assert.equal(gets, 3, "three stopped calls with failing writes: the store is skipped");
    } finally { console.warn = warn; }
  }
  { // a call that never touches the store (no tiles) says nothing about it
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    let gets = 0;
    store.get = async () => { gets++; throw new Error("hung"); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1)]);
      await c.fetchStreets([T(2, 1)]);
      await c.fetchStreets([]);
      await c.fetchStreets([T(3, 1)]);
      await c.fetchStreets([T(4, 1)]);
      assert.equal(gets, 3, "the empty call did not reset the count");
    } finally { console.warn = warn; }
  }
  { // two failing calls in flight together, the count at 2: the skip line is still logged once
    const { network } = fakeNetwork();
    const store = TileStore.memory({ maxEntries: 10 });
    store.backend = "indexeddb";
    store.get = async () => { throw new Error("hung"); };
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a);
    try {
      const c = StreetCache.create({ store, network, now: () => 0 });
      await c.fetchStreets([T(1, 1)]);
      await c.fetchStreets([T(2, 1)]);
      await Promise.all([c.fetchStreets([T(3, 1)]), c.fetchStreets([T(4, 1)])]);
    } finally { console.warn = warn; }
    assert.equal(warned.filter((w) => /skipped/.test(w[0])).length, 1);
  }
  console.log("street-cache.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
