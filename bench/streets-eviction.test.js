// StreetIndex eviction, exactly: where it starts and stops, which pieces a named caller keeps, a way two pieces list,
// and the metre frame the segments are scored in; synthetic streets, no network.
//   node bench/streets-eviction.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { StreetIndex } = global;

// piece i is tile 548+i:2040, about 1750 m wide; a cap of 100 starts dropping past 85 segments and stops at 70
const MAX = 100;
const rect = (i) => StreetIndex.tileBounds({ x: 548 + i, y: 2040 });
const lon = (i, d) => (548 + i) * 0.025 + d;
// a way of exactly k segments: k edges of 50 m going north, each edge one segment
const STEP = 50 / 110540;
const way = (id, k, i) => ({
  id,
  nodes: Array.from({ length: k + 1 }, (_, j) => id * 1000 + j),
  geometry: Array.from({ length: k + 1 }, (_, j) => ({ lat: 51.0 + j * STEP, lon: lon(i, 0.01) })),
});
const answer = (...ways) => ({ ways, groups: {} });
const source = (fresh) => async (tiles, onTile) => {
  const out = new Map();
  for (const t of tiles) {
    const a = fresh[t.x - 548] || answer();
    out.set(StreetIndex.tileId(t), a);
    onTile(t, a);
  }
  return out;
};
const held = (s, i) => s.covered(51.01, lon(i, 0.01));
const heldList = (s, n) => Array.from({ length: n }, (_, i) => held(s, i));
const wayIds = (s) => s.ways.map((w) => w.id).sort((a, b) => a - b);

// reads one piece per size in order, then one more piece of `probe` segments, and says which of the first pieces are held
async function readThenProbe(sizes, probe) {
  const fresh = sizes.map((k, i) => answer(way(i + 1, k, i)));
  fresh[sizes.length] = answer(way(sizes.length + 1, probe, sizes.length));
  const s = new StreetIndex({ newFrac: () => 1, fetchStreets: source(fresh), maxSegs: MAX });
  for (let i = 0; i < sizes.length; i++) await s.ensureRects([rect(i)]);
  await s.ensureRects([rect(sizes.length)]);
  return heldList(s, sizes.length);
}

(async () => {
  const T = true, F = false;
  { // a read drops nothing at exactly 85% of the cap, and starts at 86
    assert.deepEqual(await readThenProbe([10, 10, 10, 10, 10, 10, 10, 10, 5], 1), Array(9).fill(T), "85 segments: nothing goes");
    assert.deepEqual(await readThenProbe([10, 10, 10, 10, 10, 10, 10, 10, 6], 1), [F, F, T, T, T, T, T, T, T], "86: down past 70, two pieces");
  }
  { // and stops at exactly 70%: 90 drops two pieces (to 70), 91 drops a third (81, 71, 61)
    assert.deepEqual(await readThenProbe(Array(9).fill(10), 1), [F, F, T, T, T, T, T, T, T], "90 -> 80 -> 70: stops at 70");
    assert.deepEqual(await readThenProbe([10, 10, 10, 10, 10, 10, 10, 10, 11], 1), [F, F, F, T, T, T, T, T, T], "91 -> 81 -> 71 -> 61");
  }

  { // two callers' holds live side by side: a route edit's does not replace a suggestion's, its own next run does
    const fresh = Array.from({ length: 14 }, (_, i) => answer(way(i + 1, 10, i)));
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: source(fresh), maxSegs: MAX });
    await s.ensureRects([rect(0)], { holdAs: "suggest" });
    await s.ensureRects([rect(1)], { holdAs: "route" });
    for (const i of [2, 3, 4, 5, 6, 7, 8, 9]) await s.ensureRects([rect(i)]);
    assert.deepEqual(heldList(s, 6), [T, T, F, F, T, T], "both callers' pieces stay while the oldest others go");
    await s.ensureRects([rect(10)], { holdAs: "route" });
    for (const i of [11, 12]) await s.ensureRects([rect(i)]);
    assert.equal(held(s, 0), true, "the suggestion's piece outlives the route edit's next run");
    assert.equal(held(s, 1), false, "the route edit's earlier piece is let go by its own next run");
  }

  { // a way two pieces list stays while one of them is held, and is not counted twice when a piece brings it again
    const shared = way(9, 42, 0);
    const fresh = [answer(shared), answer(shared, way(2, 10, 1)), answer(way(3, 34, 2)), answer(way(4, 1, 3))];
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets: source(fresh), maxSegs: MAX });
    await s.ensureRects([rect(0)]);
    await s.ensureRects([rect(1)], { holdAs: "suggest" });
    await s.ensureRects([rect(2)]);
    const near = { lat: 51.01, lng: lon(0, 0.01) };
    const area = (segs) => segs * 50 * 30; // every segment is 50 m of a 30 m corridor, all of it still fogged
    assert.ok(Math.abs(s.newAreaM2(near, 6000) - area(86)) < 1e-6, "42 + 10 + 34 segments");
    await s.ensureRects([rect(3)]); // 86 segments: piece 0 goes (it lists the shared way, so nothing is freed), then piece 2
    assert.deepEqual(heldList(s, 4), [F, T, F, T]);
    assert.deepEqual(wayIds(s), [2, 4, 9], "piece 1 still lists the shared way; piece 2's way went");
    assert.ok(Math.abs(s.newAreaM2(near, 6000) - area(53)) < 1e-6, "42 + 10 + 1: the shared way is counted once");
    await s.ensureRects([rect(0)]); // the evicted piece is asked for again and lists the shared way again
    assert.deepEqual(wayIds(s), [2, 4, 9], "held once");
    assert.ok(Math.abs(s.newAreaM2(near, 6000) - area(53)) < 1e-6, "and its segments are not counted twice");
  }

  { // the metre frame is anchored on the first fetch and stays: a later run elsewhere changes no area already scored
    const south = StreetIndex.tileBounds({ x: 548, y: 2040 }), north = StreetIndex.tileBounds({ x: 548, y: 2400 });
    const edge = (id, lat) => ({ id, nodes: [id * 10, id * 10 + 1], geometry: [{ lat, lon: 13.71 }, { lat, lon: 13.7107 }] });
    const fetchStreets = async (tiles, onTile) => {
      const out = new Map();
      for (const t of tiles) {
        const a = answer(edge(t.y === 2040 ? 1 : 2, t.y === 2040 ? 51.01 : 60.01));
        out.set(StreetIndex.tileId(t), a);
        onTile(t, a);
      }
      return out;
    };
    const s = new StreetIndex({ newFrac: () => 1, fetchStreets });
    await s.ensureRects([south]);
    const first = s.newAreaM2({ lat: 51.01, lng: 13.7103 }, 300);
    const kx51 = 111320 * Math.cos((51 * Math.PI) / 180);
    assert.ok(Math.abs(first - 0.0007 * kx51 * 30) < 1e-6, "scored in the first fetch's frame");
    await s.ensureRects([north]);
    assert.equal(s.newAreaM2({ lat: 51.01, lng: 13.7103 }, 300), first, "a run at another latitude does not move the frame");
    const later = s.newAreaM2({ lat: 60.01, lng: 13.7103 }, 300);
    assert.ok(Math.abs(later - 0.0007 * kx51 * 30) < 1e-6, "and its streets are scored in the same frame");
  }
  console.log("streets-eviction.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
