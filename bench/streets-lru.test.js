// StreetIndex: near its segment cap the index drops the least recently used pieces, never one a running or held run covers; synthetic streets, no network.
//   node bench/streets-lru.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { StreetIndex } = global;

// piece i is tile 548+i:2040, lon 13.7+0.025i to 13.725+0.025i, lat 51.0-51.025, about 1750 m wide
const pos = (i) => (548 + i) + ":2040";
const rect = (i) => StreetIndex.tileBounds({ x: 548 + i, y: 2040 });
const lon = (i, d) => (548 + i) * 0.025 + d;
// a way along lat 51.01 between two longitudes: 0.021° is about 1471 m, 29 segments of ~50 m
const line = (id, a, b) => ({ id, nodes: [id * 10, id * 10 + 1], geometry: [{ lat: 51.01, lon: a }, { lat: 51.01, lon: b }] });
const inPiece = (id, i) => line(id, lon(i, 0.002), lon(i, 0.023));
const answer = (...ways) => ({ ways, groups: {} });
// a cap of 100 starts dropping pieces past 85 segments and drops them down to 70
const MAX = 100;

// A source answering a run from `fresh`; records the pieces each run asks for.
function source({ fresh = {} }) {
  const asked = [];
  const fetchStreets = async (tiles, onTile) => {
    const out = new Map();
    asked.push(tiles.map((t) => t.x + ":" + t.y));
    for (const t of tiles) {
      const k = t.x + ":" + t.y;
      out.set(k, fresh[k]);
      onTile(t, fresh[k]);
    }
    return out;
  };
  return { fetchStreets, asked };
}
const wayIds = (s) => s.ways.map((w) => w.id).sort();
// a piece is held when the index says it covers a point inside it
const held = (s, i) => s.covered(51.01, lon(i, 0.01));

(async () => {
  { // the least recently used piece goes: its segments come back, graphs hear of it, and a run asks for it again
    const src = source({ fresh: { [pos(0)]: answer(inPiece(1, 0)), [pos(1)]: answer(inPiece(2, 1)), [pos(2)]: answer(inPiece(3, 2)), [pos(3)]: answer(inPiece(4, 3)) } });
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: src.fetchStreets, maxSegs: MAX });
    for (const i of [0, 1, 2]) await s.ensureRects([rect(i)]);
    const version = s.version;
    await s.ensureRects([rect(3)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(s, i)), [false, true, true, true]);
    assert.deepEqual(wayIds(s), [2, 3, 4]);
    assert.ok(s.version > version);
    assert.equal(s.covered(51.01, lon(0, 0.01)), false, "an evicted piece is not held");
    const before = src.asked.length;
    await s.ensureRects([rect(0)]);
    assert.deepEqual(src.asked.slice(before), [[pos(0)]], "the evicted piece is missing again");
  }
  const four = { [pos(0)]: answer(inPiece(1, 0)), [pos(1)]: answer(inPiece(2, 1)), [pos(2)]: answer(inPiece(3, 2)), [pos(3)]: answer(inPiece(4, 3)), [pos(4)]: answer(inPiece(5, 4)) };
  { // a run over a held piece uses it: the next piece goes instead
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: source({ fresh: four }).fetchStreets, maxSegs: MAX });
    for (const i of [0, 1, 2]) await s.ensureRects([rect(i)]);
    await s.ensureRects([rect(0)]);
    await s.ensureRects([rect(3)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(s, i)), [true, false, true, true]);
  }
  { // a caller's held pieces stay until its next run; the run reading a piece never drops its own
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: source({ fresh: four }).fetchStreets, maxSegs: MAX });
    await s.ensureRects([rect(0)], { holdAs: "suggest" });
    for (const i of [1, 2, 3]) await s.ensureRects([rect(i)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(s, i)), [true, false, true, true], "the suggestion's piece is kept, the next oldest goes");
    await s.ensureRects([rect(4)], { holdAs: "suggest" });
    assert.deepEqual([0, 2, 3, 4].map((i) => held(s, i)), [false, true, true, true], "its next run lets the old one go");
    const t = new StreetIndex({ newFrac: () => 1, fetchStreets: source({ fresh: four }).fetchStreets, maxSegs: MAX });
    await t.ensureRects([rect(0), rect(1), rect(2), rect(3)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(t, i)), [true, true, true, true], "nothing it covers is evicted: the cap cuts in instead");
  }
  { // a piece under a run still running is not evicted by another run's read
    let release;
    const gate = new Promise((r) => { release = r; });
    const plain = source({ fresh: four }).fetchStreets;
    const s = new StreetIndex({ newFrac: () => 1, maxSegs: MAX, fetchStreets: async (tiles, onTile, opts) => {
      if (tiles.some((t) => t.x === 548)) { onTile(tiles[0], four[pos(0)]); await gate; return new Map(); }
      return plain(tiles, onTile, opts);
    } });
    const slow = s.ensureRects([rect(0)]);
    await Promise.resolve();
    for (const i of [1, 2, 3]) await s.ensureRects([rect(i)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(s, i)), [true, false, true, true]);
    release();
    await slow;
  }
  { // a way two pieces list survives while either holds it, and goes with the second
    const shared = line(9, lon(0, 0.010), lon(1, 0.015)); // 0.030°, 42 segments
    const s = new StreetIndex({ newFrac: () => 1, maxSegs: 80, fetchStreets: source({ fresh: {
      [pos(0)]: answer(shared), [pos(1)]: answer(shared), [pos(2)]: answer(inPiece(3, 2)), [pos(3)]: answer(inPiece(4, 3)), [pos(4)]: answer(inPiece(5, 4)) } }).fetchStreets });
    // a cap of 80 drops past 68 down to 56; piece 1 is read after piece 2, so 0 and then 2 are the oldest
    for (const i of [0, 2, 1, 3]) await s.ensureRects([rect(i)]);
    assert.deepEqual([0, 1, 2, 3].map((i) => held(s, i)), [false, true, false, true]);
    assert.ok(wayIds(s).includes(9), "piece 1 still lists the shared way");
    await s.ensureRects([rect(4)]);
    assert.deepEqual([1, 3, 4].map((i) => held(s, i)), [false, true, true]);
    assert.ok(!wayIds(s).includes(9), "no piece lists it any more");
  }
  { // a failed run, and a bad rect, protect nothing afterwards
    const plain = source({ fresh: four }).fetchStreets;
    const s = new StreetIndex({ newFrac: () => 1, maxSegs: MAX, fetchStreets: async (tiles, onTile, opts) => {
      if (tiles.some((t) => t.x === 548)) throw Object.assign(new Error("offline"), { reason: "offline" });
      return plain(tiles, onTile, opts);
    } });
    await s.ensureRects([rect(1)]);
    await assert.rejects(s.ensureRects([rect(0), rect(1)]), (e) => StreetIndex.isDownloadError(e));
    await assert.rejects(s.ensureRects(null), TypeError);
    for (const i of [2, 3, 4]) await s.ensureRects([rect(i)]);
    assert.equal(held(s, 1), false, "the failed run's piece goes like any other");
  }
  { // a piece that brought no way still goes
    const s = new StreetIndex({ newFrac: () => 1, maxSegs: MAX, fetchStreets: source({ fresh: Object.assign({}, four, { [pos(0)]: answer() }) }).fetchStreets });
    await s.ensureRects([rect(0)]);
    await s.ensureRects([rect(1), rect(2), rect(3)], { holdAs: "suggest" });
    await s.ensureRects([rect(4)]);
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => held(s, i)), [false, true, true, true, true]);
  }
  console.log("streets-lru.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
