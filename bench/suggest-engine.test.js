// The route editor asks the engine object for its street graph, not the suggestion tool: the engine is built apart
// from the tool, shares its run state with it, and hands the editor a fresh planner once the streets or the fog
// have outgrown the graph a suggestion holds (a graph still current is the held one).
// Synthetic streets, no network.
//   node bench/suggest-engine.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { SuggestTool, SuggestEngine, StreetIndex } = global;

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
const fogMap = { tileCount: 0, hasFog: () => false };

(async () => {
  { // no streets, no graph
    assert.equal(SuggestEngine.create({ fogMap }).streetGraph(), null);
  }
  { // the engine and the tool that was given it are one run state
    const s = streetsWith(street);
    const engine = SuggestEngine.create({ streets: s, fogMap });
    const tool = new SuggestTool(global.fakeMap(), { engine, fogMap, computeGain: () => ({ area: 1, newPct: 1 }) });
    assert.equal(tool.streets, s, "the tool reads the engine's streets");
    const planner = engine.streetGraph();
    assert.ok(planner);
    assert.equal(tool.streetGraph(), planner, "same planner from either side");
    assert.equal(tool._planner, planner);
    tool.clearResults();
    assert.equal(engine._runId, 1, "clearResults bumps the engine's run id");
    engine._runId = 7;
    assert.equal(tool._runId, 7, "and the tool sees the engine's");
  }
  { // a suggestion holds its graph; the editor's request on the engine gets a fresh planner, not the held one
    const s = streetsWith(street);
    const engine = SuggestEngine.create({ streets: s, fogMap });
    const tool = new SuggestTool(global.fakeMap(), { engine, fogMap, computeGain: () => ({ area: 1, newPct: 1 }) });
    tool.mode = "p2p"; tool.a = pin(0, 0); tool.b = pin(1000, 0);
    const route = global.LocalRouter.prototype.route;
    const held = [];
    let editor = null;
    global.LocalRouter.prototype.route = function (...args) {
      const out = route.apply(this, args);
      held.push(this.planner);
      if (held.length === 1) {
        s._addWay({ id: 9, nodes: [3, 9], geometry: [ll(1000, 0), ll(1500, 0)] });
        s.version++;
        editor = engine.streetGraph();
        editor.build();
      }
      return out;
    };
    try { await tool.suggest({ buffer: 0.15 }); } finally { global.LocalRouter.prototype.route = route; }
    assert.ok(held.length > 1, `routes ${held.length}`);
    assert.ok(held.every((p) => p === held[0]), "one graph for the whole suggestion");
    assert.notEqual(editor, held[0], "the editor's graph is not the held one");
    assert.equal(engine._hold, null, "released when the run ends");
    assert.equal(held[0].held, false);
  }
  console.log("suggest-engine.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
