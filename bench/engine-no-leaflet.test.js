// The planner runs with no Leaflet at all: the host has no L, the pins are plain {lat, lng}, nothing is drawn, and a
// suggestion still ends in its cards. Also pins what the engine object and main.js's wiring of it promise.
// Synthetic streets, no network.
//   node bench/engine-no-leaflet.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("./lib/host.js");
require("../app/src/engine.ts");
const { SuggestTool, SuggestEngine, StreetIndex } = global;

assert.equal(global.L, undefined, "this test runs without the Leaflet stub");

const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
const pin = (x, y) => { const p = { lat: 51 + y / KY, lng: 13.7 + x / KX }; return { getLatLng: () => p }; };
function streetsWith(ways) {
  const s = new StreetIndex({ newFrac: () => 1 });
  s._anchor(51);
  for (const [id, nodes, p, q] of ways) s._addWay({ id, nodes, geometry: [ll(...p), ll(...q)] });
  s._cover(StreetIndex.tilesCovering({ s: 50.9, n: 51.1, w: 13.6, e: 13.8 }), "run");
  return s;
}
const street = [[1, [1, 2], [0, 0], [500, 0]], [2, [2, 3], [500, 0], [1000, 0]], [3, [1, 4], [0, 0], [0, 300]], [4, [4, 3], [0, 300], [1000, 0]]];
const fogMap = { tileCount: 0, hasFog: () => false, version: 0 };

(async () => {
  { // a p2p suggestion without a map
    const emits = [];
    const tool = new SuggestTool({}, { fogMap, computeGain: () => ({ area: 1, newPct: 1 }), streets: streetsWith(street), onResults: (s) => emits.push(s) });
    let draws = 0;
    tool._draw = () => { draws++; };
    tool.mode = "p2p"; tool.a = pin(0, 0); tool.b = pin(1000, 0);
    await tool.suggest({ buffer: 0.15 });
    const last = emits[emits.length - 1];
    assert.ok(last && Array.isArray(last.list) && last.list.length >= 1, "the run ends in a card list");
    assert.equal(draws, 1, "the screen half ran once, and it is the only part that would need Leaflet");
  }
  { // a loop suggestion without a map
    const emits = [];
    const tool = new SuggestTool({}, { fogMap, computeGain: () => ({ area: 1, newPct: 1 }), streets: streetsWith(street), onResults: (s) => emits.push(s) });
    tool._draw = () => {};
    tool.mode = "loop"; tool.a = pin(0, 0);
    await tool.suggest({ buffer: 0.3, distM: 2500 });
    const last = emits[emits.length - 1];
    assert.ok(last && Array.isArray(last.list) && last.list.length >= 1, "the loop run ends in a card list");
    assert.ok(!emits.some((e) => e && e.error), "no emit was an error");
    assert.ok(last.list.every((c) => c.km > 0 && typeof c.newPct === "number"), "each card has a length and a new-ground share");
  }
  { // an engine with no tool rebuilds its planner in place when the fog moves, like the tool's does
    const fog = { tileCount: 0, hasFog: () => false, version: 0 };
    const engine = SuggestEngine.create({ streets: streetsWith(street), fogMap: fog });
    const planner = engine.streetGraph();
    planner.build();
    const stamp = planner.builtStamp;
    fog.version = 1;
    assert.equal(engine.streetGraph(), planner, "same planner after a fog change");
    planner.build();
    assert.notEqual(planner.builtStamp, stamp, "rebuilt in place for the new fog");
  }
  { // a tool given an engine reads the engine's streets and fog, not its own options
    const s1 = streetsWith(street), s2 = streetsWith(street);
    const engine = SuggestEngine.create({ streets: s1, fogMap });
    const other = { tileCount: 0, hasFog: () => false };
    const tool = new SuggestTool({}, { engine, streets: s2, fogMap: other, computeGain: () => null });
    assert.equal(tool.streets, s1);
    assert.equal(tool.fogMap, fogMap);
    assert.equal(tool.streetGraph(), engine.streetGraph(), "the editor's graph and the tool's are one planner");
    tool._holdGraph();
    assert.ok(engine._hold, "a hold taken through the tool lands on the engine");
    engine._runId = 7;
    assert.equal(tool._runId, 7, "the run id is the engine's");
  }
  { // main.js builds one engine and hands it to the route editor and to the tool
    const main = fs.readFileSync(path.join(__dirname, "../app/src/main.js"), "utf8");
    assert.equal(main.match(/SuggestEngine\.create\(/g).length, 1, "one engine");
    assert.match(main, /SuggestEngine\.create\(\{[^}]*\bstreets\b[^}]*\bfogMap\b[^}]*\}\)/);
    assert.match(main, /streetGraph: \(\) => engine\.streetGraph\(\)/, "the route editor asks the engine");
    assert.match(main, /new SuggestTool\(map, \{[^}]*\bengine\b/, "and the tool is given the same engine");
    assert.doesNotMatch(main, /suggest\.streetGraph\(/, "nothing reaches the graph through the tool");
  }
  console.log("engine-no-leaflet.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
