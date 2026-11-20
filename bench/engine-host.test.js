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

const answer = (status) => ({ ok: status === 200, status, body: null, headers: { get: () => null }, json: async () => ({ elements: [] }) });
const KEY = "made-up-key/9"; // a made-up key, as in every other test

(async () => {
  const warn = console.warn; console.warn = () => {};
  const realFetch = global.fetch;
  const realIdb = global.indexedDB;
  const hadNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  try {
    // the globals say the opposite of the host everywhere
    global.fetch = () => { throw new Error("read the global fetch"); };
    delete global.crossfogNextgisKey;
    Object.defineProperty(global, "navigator", { value: { onLine: true }, configurable: true, writable: true });

    { // fetch, the key and onLine come from the host, each read when the call runs
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
  } finally {
    console.warn = warn;
    global.fetch = realFetch;
    if (realIdb) global.indexedDB = realIdb; else delete global.indexedDB;
    if (hadNavigator) Object.defineProperty(global, "navigator", hadNavigator); else delete global.navigator;
    delete global.crossfogNextgisKey;
    bindOverpassHost(globalThis);
    Overpass._reset();
  }
  console.log("engine-host.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
