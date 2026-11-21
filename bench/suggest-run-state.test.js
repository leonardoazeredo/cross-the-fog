// What a suggestion run does when it is replaced, when the fog changes under it and when a pin is moved or removed
// mid-run, pinned as it is today so that moving the code that owns it cannot change it; synthetic streets, no network.
//   node bench/suggest-run-state.test.js
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

// a tool whose results are collected; mode "p2p" or "loop"
function build(mode, ways, fogMap) {
  const emits = [];
  const tool = new SuggestTool(global.fakeMap(), {
    fogMap: fogMap || { tileCount: 0, hasFog: () => false },
    computeGain: () => ({ area: 1, newPct: 1 }),
    isNew: () => true,
    streets: streetsWith(ways),
    onResults: (s) => emits.push(s),
  });
  tool.mode = mode;
  tool.a = pin(0, 0);
  if (mode === "p2p") tool.b = pin(1000, 0);
  return { tool, emits };
}
const go = (tool) => (tool.mode === "loop" ? tool.suggest({ distM: 3000, buffer: 0.15 }) : tool.suggest({ buffer: 0.15 }));

// what a moved pin does in the page: the marker's dragend handler clears the results (and so cancels the run)
const dragPin = (tool, x, y) => { tool.a = pin(x, y); tool.clearResults(); };

// a routed A to B detour just over the length budget (1150 m here), so the run pulls its via point back toward the line
const overshoot = { lenM: 1160, coords: [[13.7, 51], [13.71, 51]], legs: [{ coords: [[13.7, 51]], edges: [] }, { coords: [[13.71, 51]], edges: [] }] };

// the first `_route` call of the kind `pick` selects (3 points: a via route) runs `act` before it answers
function onRoute(tool, pick, act, answer) {
  const orig = tool._route;
  let done = false;
  tool._route = async function (pts, o) {
    if (!done && pick(pts)) { done = true; act(); if (answer) return answer; }
    return orig.call(this, pts, o);
  };
}

(async () => {
  for (const mode of ["p2p", "loop"]) {
    { // a run replaced mid-await ends without a word: no later state, no result, no thrown error
      const { tool, emits } = build(mode, mode === "loop" ? ring : street);
      let atReplace = -1, held = null;
      onRoute(tool, () => true, () => {
        held = tool._hold && tool._hold.planner;
        tool.clearResults();
        atReplace = emits.length;
        // the route editor must not be handed a graph that is still marked held while the replaced run winds down
        assert.ok(held && tool._hold === null && held.held === false, `${mode}: clearResults lets go of the graph at once`);
      });
      await go(tool);
      assert.ok(atReplace > 0 && emits[atReplace - 1] === null, `${mode}: clearResults tells the page there are no results`);
      assert.equal(emits.length, atReplace, `${mode}: the replaced run emitted nothing after it was replaced`);
      assert.deepEqual([tool.results.length, tool.lines.length], [0, 0], `${mode}: and left no result`);
      assert.equal(tool._hold, null, `${mode}: and no held graph`);
    }
    { // a download that reports progress after the run was replaced is not heard either
      const { tool, emits } = build(mode, mode === "loop" ? ring : street);
      let atReplace = -1, routes = 0, holds = 0;
      tool.streets.ensureRects = async (rects, o) => {
        tool.clearResults();
        atReplace = emits.length;
        o.onProgress({ done: 1, total: 2 });
        return { done: 2, total: 2 };
      };
      const route = tool._route, hold = tool._holdGraph;
      tool._route = function (...a) { routes++; return route.apply(this, a); };
      tool._holdGraph = function (...a) { holds++; return hold.apply(this, a); };
      await go(tool);
      assert.ok(atReplace > 0 && emits.length === atReplace, `${mode}: no progress from the replaced run's download`);
      assert.deepEqual([routes, holds, tool._hold], [0, 0, null], `${mode}: and it neither holds a graph nor routes once replaced`);
    }
    { // a pin dragged mid-run cancels it the same way
      const { tool, emits } = build(mode, mode === "loop" ? ring : street);
      let atDrag = -1;
      onRoute(tool, () => true, () => { dragPin(tool, 0, 200); atDrag = emits.length; });
      await go(tool);
      assert.ok(atDrag > 0 && emits[atDrag - 1] === null);
      assert.equal(emits.length, atDrag, `${mode}: nothing is shown for the pin's old place`);
      assert.deepEqual([tool.results.length, tool.lines.length], [0, 0]);
    }
  }

  { // a pin removed mid-run in loop mode ends the run without a word too
    const { tool, emits } = build("loop", ring);
    let atRemove = -1;
    onRoute(tool, () => true, () => { tool._removePin(tool.a); atRemove = emits.length; });
    await go(tool);
    assert.ok(atRemove > 0 && emits[atRemove - 1] === null);
    assert.equal(emits.length, atRemove, "nothing is emitted after the pin was removed");
    assert.deepEqual([tool.results.length, tool.lines.length, tool._hold], [0, 0, null]);
  }

  { // the fog changing under a run: the held graph stays the run's and is let go when the run ends, and the editor's
    // call gets a newer one
    const fog = { tileCount: 0, hasFog: () => false, version: 0 };
    const { tool } = build("p2p", street, fog);
    const held = [];
    let editor = null, stamp = null;
    const graph = tool._graph;
    tool._graph = function (...a) {
      const p = graph.apply(this, a);
      if (p) held.push(p);
      if (p && !editor) {
        stamp = p.builtStamp;
        fog.version++;
        assert.equal(p.isCurrent(), false, "the held graph is out of date once the fog moved");
        editor = tool.streetGraph();
        editor.build();
      }
      return p;
    };
    await go(tool);
    assert.ok(held.length > 1 && held.every((p) => p === held[0]), "one graph for the whole run");
    assert.equal(held[0].builtStamp, stamp, "not rebuilt in place by the fog change");
    assert.notEqual(editor, held[0], "streetGraph() replaced the held planner that was out of date");
    assert.equal(held[0].held, false, "released when the run ended");
    assert.equal(tool.streetGraph(), editor, "the slot keeps the planner the editor was given");
  }

  { // a pin removed mid-run, where the run would read it live after an await (_viaPoint, pulling an overshooting via
    // back): the run ends without a word, with nothing shown after the page was told there are no results
    const { tool, emits } = build("p2p", street);
    let atRemove = -1;
    onRoute(tool, (p) => p.length === 3, () => { tool._removePin(tool.a); atRemove = emits.length; }, overshoot);
    await go(tool);
    assert.ok(atRemove > 0 && emits[atRemove - 1] === null);
    assert.equal(emits.length, atRemove, "nothing is emitted after the pin was removed");
    assert.equal(tool._hold, null, "the graph is released");
  }
  { // the same moment when the pin was dragged: the run is over, so no via is built from the new place
    const { tool, emits } = build("p2p", street);
    let atDrag = -1;
    onRoute(tool, (p) => p.length === 3, () => { dragPin(tool, 0, 200); atDrag = emits.length; }, overshoot);
    await go(tool);
    assert.equal(emits.length, atDrag, "nothing is shown for the old pin");
  }
  { // _viaCandidates and _diversify read the pins live too, but only after a stale() check: a pin removed during
    // the base route ends the run quietly
    const { tool, emits } = build("p2p", street);
    onRoute(tool, (p) => p.length === 2, () => tool._removePin(tool.a));
    await go(tool);
    assert.equal(emits[emits.length - 1], null);
    assert.deepEqual([tool.results.length, tool.lines.length], [0, 0]);
  }

  for (const mode of ["p2p", "loop"]) { // a run that replaces another keeps its graph held while the older one winds down
    const { tool } = build(mode, mode === "loop" ? ring : street);
    let newer = null, checks = 0, lost = 0;
    const route = tool._route;
    tool._route = async function (pts, o) {
      if (!newer) {
        newer = go(tool); // replaces the run that is routing now
        await new Promise((r) => setTimeout(r));
      } else {
        checks++;
        if (!(this._hold && this._hold.runId === this._runId && this._hold.planner.held)) lost++;
      }
      return route.call(this, pts, o);
    };
    await go(tool);
    await newer;
    assert.ok(checks > 0, `${mode}: the newer run routed`);
    assert.equal(lost, 0, `${mode}: the older run's end never lets go of the newer run's graph`);
    assert.equal(tool._hold, null, `${mode}: released when the newer run ends`);
  }

  { // resampleMids: n points spread by length along a line, each the first vertex at or past its share
    const { resampleMids } = SuggestTool._internals;
    const coords = [[13.70, 51], [13.701, 51], [13.703, 51], [13.706, 51]];
    assert.deepEqual(resampleMids(coords, 2).map((p) => [p.lng, p.lat]), [[13.703, 51], [13.706, 51]]);
    assert.deepEqual(resampleMids(coords, 1).map((p) => [p.lng, p.lat]), [[13.703, 51]]);
    assert.deepEqual(resampleMids(coords, 0), []);
  }
  console.log("suggest-run-state: ok");
})().catch((e) => { console.error(e); process.exit(1); });
