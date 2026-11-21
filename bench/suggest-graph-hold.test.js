// A suggestion plans on one graph from its first route to its last, while streets another run merges
// meanwhile reach the route editor at once; synthetic streets, no network.
//   node bench/suggest-graph-hold.test.js
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

(async () => {
  const s = streetsWith(street);
  const tool = new SuggestTool(global.fakeMap(), { fogMap: { tileCount: 0, hasFog: () => false }, computeGain: () => ({ area: 1, newPct: 1 }), streets: s });
  tool.mode = "p2p"; tool.a = pin(0, 0); tool.b = pin(1000, 0);
  const route = global.LocalRouter.prototype.route;
  const seen = [];
  let editor = null;
  global.LocalRouter.prototype.route = function (...args) {
    const out = route.apply(this, args);
    seen.push([this.planner, this.planner.builtStamp, this.planner.edges.length]);
    if (seen.length === 1) {
      // another run's tile lands between two of the suggestion's routes
      s._addWay({ id: 9, nodes: [3, 9], geometry: [ll(1000, 0), ll(1500, 0)] });
      s.version++;
      editor = tool.streetGraph();
      editor.build();
    }
    return out;
  };
  await tool.suggest({ buffer: 0.15 });
  global.LocalRouter.prototype.route = route;
  assert.ok(seen.length > 1, `routes ${seen.length}`);
  assert.ok(seen.every(([p, stamp]) => p === seen[0][0] && stamp === seen[0][1]), "one graph for the whole suggestion");
  assert.notEqual(editor, seen[0][0], "the editor is not handed the graph the suggestion holds");
  assert.equal(editor.edges.length, seen[0][2] + 1, "the editor's graph has the new street");
  const after = tool.streetGraph();
  after.build();
  assert.equal(after.edges.length, seen[0][2] + 1, "once the suggestion ends, its graph is current again");
  assert.equal(after.held, false);

  { // a run cancelled while it holds a graph lets go of it
    const t = new SuggestTool(global.fakeMap(), { fogMap: { tileCount: 0, hasFog: () => false }, computeGain: () => ({ area: 1, newPct: 1 }), streets: streetsWith(street) });
    t.mode = "p2p"; t.a = pin(0, 0); t.b = pin(1000, 0);
    let held = null;
    const orig = t._route;
    t._route = async function (...a) { held = held || this._graph(); this.clearResults(); return orig.apply(this, a); };
    await t.suggest({ buffer: 0.15 });
    assert.equal(held.held, false);
  }
  { // an older run that ends while a newer one plans leaves the newer run's graph held
    const st = streetsWith(street);
    const t = new SuggestTool(global.fakeMap(), { fogMap: { tileCount: 0, hasFog: () => false }, computeGain: () => ({ area: 1, newPct: 1 }), streets: st });
    t.mode = "p2p"; t.a = pin(0, 0); t.b = pin(1000, 0);
    let openOld, openNew;
    const oldGate = new Promise((r) => { openOld = r; }), newGate = new Promise((r) => { openNew = r; });
    let calls = 0;
    st.ensureRects = async () => { if (++calls === 1) await oldGate; return { done: 1, total: 1 }; };
    const orig = t._route;
    let parked = null;
    t._route = async function (...a) {
      if (!parked) { parked = this._hold; await newGate; }
      return orig.apply(this, a);
    };
    const older = t.suggest({ buffer: 0.15 });
    const newer = t.suggest({ buffer: 0.15 });
    await new Promise((r) => setImmediate(r));
    assert.ok(parked && parked.planner.held, "the newer run holds its graph");
    openOld();
    await older;
    assert.equal(t._hold, parked, "still the newer run's");
    assert.equal(parked.planner.held, true);
    openNew();
    await newer;
    assert.equal(t._hold, null);
  }
  { // loop mode holds its graph too: a street another run merges mid-run reaches the editor, not the loop's graph
    const st = streetsWith(street.concat([[5, [3, 6], [1000, 0], [1000, 300]], [6, [6, 4], [1000, 300], [0, 300]]]));
    const tool = new SuggestTool(global.fakeMap(), { fogMap: { tileCount: 0, hasFog: () => false }, computeGain: () => ({ area: 1, newPct: 1 }), isNew: () => true, streets: st });
    tool.mode = "loop"; tool.a = pin(0, 0);
    const held = [];
    let editor = null, injected = false;
    const graphFor = tool._graph;
    tool._graph = function (...a) {
      const p = graphFor.apply(this, a);
      if (p) held.push([p, p.held]);
      if (p && !injected) {
        injected = true;
        st._addWay({ id: 9, nodes: [3, 9], geometry: [ll(1000, 0), ll(1500, 0)] });
        st.version++;
        editor = tool.streetGraph();
        editor.build();
      }
      return p;
    };
    await tool.suggest({ distM: 3000, buffer: 0.15 });
    assert.ok(held.length > 0 && editor, "the loop run planned on a held graph");
    assert.ok(held.every(([p, isHeld]) => p === held[0][0] && isHeld === true), "one held graph for the whole loop run");
    assert.notEqual(editor, held[0][0], "the editor is not handed the loop's graph");
    assert.equal(tool._hold, null, "released when the run ends");
    assert.equal(held[0][0].held, false);
  }
  { // an eviction through ensureRects while a suggestion holds its graph: the held graph keeps the dropped ways, its edge ids
    // stay valid, and every leg is the one a run without the eviction finds
    const unrelated = (i) => StreetIndex.tileBounds({ x: 600 + i, y: 2040 });
    // 40 segments of 50 m in a tile no suggestion rect reaches, and 5 more in the tile that makes room
    const far = (id, k, lon0) => ({
      id,
      nodes: Array.from({ length: k + 1 }, (_, j) => id * 1000 + j),
      geometry: Array.from({ length: k + 1 }, (_, j) => ({ lat: 51.0 + (j * 50) / KY, lon: lon0 })),
    });
    const fogless = { tileCount: 0, hasFog: () => false };
    const run = async (evict) => {
      const answers = { "548:2040": { ways: street.map(([id, nodes, p, q]) => ({ id, nodes, geometry: [ll(...p), ll(...q)] })), groups: {} } };
      answers["600:2040"] = { ways: [far(50, 40, 15.01)], groups: {} };
      answers["601:2040"] = { ways: [far(60, 5, 15.04)], groups: {} };
      const fetchStreets = async (tiles, onTile) => {
        const out = new Map();
        // the street tile last: every read checks the cap first, so the pieces read after it would drop the unrelated one
        // before the suggestion has routed
        for (const t of [...tiles].sort((p, q) => (StreetIndex.tileId(p) === "548:2040") - (StreetIndex.tileId(q) === "548:2040"))) {
          const a = answers[StreetIndex.tileId(t)] || { ways: [], groups: {} };
          out.set(StreetIndex.tileId(t), a);
          onTile(t, a);
        }
        return out;
      };
      // 47 street segments + 40 = 87, past 85% of 100: the next read drops the oldest piece nobody holds
      const st = new StreetIndex({ newFrac: () => 1, fetchStreets, maxSegs: 100 });
      await st.ensureRects([unrelated(0)]);
      const t = new SuggestTool(global.fakeMap(), { fogMap: fogless, computeGain: () => ({ area: 1, newPct: 1 }), streets: st });
      t.mode = "p2p"; t.a = pin(0, 0); t.b = pin(1000, 0);
      const orig = t._route;
      const legs = [];
      let calls = 0, heldWays = [], planner = null;
      t._route = async function (...a) {
        const out = await orig.apply(this, a);
        planner = this._graph();
        if (++calls === 1 && evict) await st.ensureRects([unrelated(1)]);
        if (out) for (const leg of out.legs) legs.push({ coords: leg.coords, edges: leg.edges });
        heldWays = [...new Set(planner.edges.map((e) => e.way))].sort((x, y) => x - y);
        return out;
      };
      await t.suggest({ buffer: 0.15 });
      return { st, t, legs, heldWays, planner, calls };
    };
    const plain = await run(false);
    const dropped = await run(true);
    assert.ok(plain.calls > 1 && dropped.calls > 1, "routes on both sides of the eviction");
    assert.equal(dropped.st.covered(51.01, 15.01), false, "the unrelated piece was evicted");
    assert.equal(plain.st.covered(51.01, 15.01), true, "and not in the run without the second read");
    assert.ok(!dropped.st.ways.some((w) => w.id === 50), "its way is gone from the index");
    assert.ok(dropped.st.ways.some((w) => w.id === 1), "the suggestion's own streets are not");
    assert.deepEqual(dropped.legs, plain.legs, "every leg is the one found without the eviction");
    const ways = (planner) => [...new Set(planner.edges.map((e) => e.way))].sort((x, y) => x - y);
    assert.deepEqual(dropped.heldWays, [1, 2, 3, 4, 50], "the held graph kept the dropped way, and did not take the one read meanwhile");
    assert.deepEqual(plain.heldWays, [1, 2, 3, 4, 50], "as in a run without the second read");
    assert.ok(dropped.legs.length > 0 && dropped.legs.every((l) => l.edges.length > 0 && l.edges.every((e) => dropped.planner.edges[e] !== undefined)), "every leg edge is an edge of the held planner");
    const rebuilt = dropped.t.streetGraph();
    rebuilt.build();
    assert.deepEqual(ways(rebuilt), [1, 2, 3, 4, 60], "once the suggestion ends, a rebuilt graph has what the index holds now");
  }
  console.log("suggest-graph-hold: ok");
})().catch((e) => { console.error(e); process.exit(1); });
