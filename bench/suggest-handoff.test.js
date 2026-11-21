// What each run hands to _finish: the fields the page builds its card header from (main.js reads baseKm, wantKm,
// clamped and fallback for A to B, targetKm and bufferPct for a loop) and the loop's start, without which the
// loop's bearing spread silently stops; synthetic streets, no network.
//   node bench/suggest-handoff.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { SuggestTool, StreetIndex } = global;

const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
const pin = (x, y) => { const p = global.L.latLng(51 + y / KY, 13.7 + x / KX); return { getLatLng: () => p }; };
function streetsWith(ways) {
  const s = new StreetIndex({ newFrac: () => 1 });
  s._anchor(51);
  for (const [id, nodes, p, q] of ways) s._addWay({ id, nodes, geometry: [ll(...p), ll(...q)] });
  s._cover(StreetIndex.tilesCovering({ s: 50.9, n: 51.1, w: 13.6, e: 13.8 }), "run");
  return s;
}
const street = [[1, [1, 2], [0, 0], [500, 0]], [2, [2, 3], [500, 0], [1000, 0]], [3, [1, 4], [0, 0], [0, 300]], [4, [4, 3], [0, 300], [1000, 0]]];
const ring = street.concat([[5, [3, 6], [1000, 0], [1000, 300]], [6, [6, 4], [1000, 300], [0, 300]]]);

// the arguments of every _finish call, which still does its work
function build(mode, ways) {
  const calls = [];
  const tool = new SuggestTool(global.fakeMap(), {
    fogMap: { tileCount: 0, hasFog: () => false },
    computeGain: () => ({ area: 1, newPct: 100 }),
    isNew: () => true,
    streets: streetsWith(ways),
    onResults: () => {},
  });
  const real = tool._finish;
  tool._finish = function (...args) { calls.push(args); return real.apply(this, args); };
  tool.mode = mode;
  tool.a = pin(0, 0);
  if (mode === "p2p") tool.b = pin(1000, 0);
  return { tool, calls };
}

(async () => {
  { // A to B: the base route is the straight 1000 m street; no wanted length, nothing clamped, no fallback
    const { tool, calls } = build("p2p", street);
    const id0 = tool._runId;
    await tool.suggest({ buffer: 0.15 });
    assert.equal(calls.length, 1, "p2p: one finish");
    const [runId, , extra, S] = calls[0];
    assert.equal(runId, id0 + 1, "p2p: the run's own id (clearResults at its start bumped it once)");
    assert.deepEqual(Object.keys(extra).sort(), ["baseKm", "bufferPct", "clamped", "fallback", "wantKm"], "p2p: the fields the page reads");
    assert.ok(Math.abs(extra.baseKm - 1) < 0.01, "p2p: baseKm is the base route's length in km");
    assert.deepEqual([extra.bufferPct, extra.wantKm, extra.clamped, extra.fallback], [15, null, false, false], "p2p: buffer, no wanted length, not clamped, no fallback");
    assert.equal(S, undefined, "p2p: no loop start");
  }

  { // A to B with a wanted length shorter than the base route: clamped up to the base route
    const { tool, calls } = build("p2p", street);
    await tool.suggest({ buffer: 0.15, targetM: 400 });
    const extra = calls[0][2];
    assert.equal(extra.clamped, true, "p2p wanted: a wanted length under the base route is clamped");
    assert.ok(Math.abs(extra.wantKm - extra.baseKm) < 1e-9 && Math.abs(extra.wantKm - 1) < 0.01, "p2p wanted: and reported as the length it was clamped to, the base route's");
  }

  { // a wanted length above the base route is kept as asked and not clamped
    const { tool, calls } = build("p2p", street);
    await tool.suggest({ buffer: 0.15, targetM: 1500 });
    const extra = calls[0][2];
    assert.deepEqual([extra.wantKm, extra.clamped], [1.5, false], "p2p longer: reported as asked, not clamped");
  }

  { // loop: the target in km, the tolerance in percent, and the start pin's own point
    const { tool, calls } = build("loop", ring);
    const id0 = tool._runId;
    await tool.suggest({ distM: 3000, buffer: 0.15 });
    assert.equal(calls.length, 1, "loop: one finish");
    const [runId, cands, extra, S] = calls[0];
    assert.equal(runId, id0 + 1, "loop: the run's own id");
    assert.deepEqual(extra, { targetKm: 3, bufferPct: 15 }, "loop: the fields the page reads");
    const a = tool.a.getLatLng();
    assert.deepEqual([S.lat, S.lng], [a.lat, a.lng], "loop: the start is the pin's point");
    assert.ok(Array.isArray(cands) && cands.length > 0, "loop: candidates were handed on");
  }
  console.log("suggest-handoff: ok");
})().catch((e) => { console.error(e); process.exit(1); });
