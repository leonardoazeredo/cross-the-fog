// Fog that moves while the page is open: street fractions, planner rewards and suggestion planners follow it.
//   node bench/fog-invalidate.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
require("./lib/host.js");
require("../app/src/engine.ts");
const { gainOver } = require("./lib/fog.js");
const { FogParser, StreetIndex, GraphPlanner, SuggestTool, Reveal } = global;

const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
// a 500 m street due east, as one way with a node every 100 m
const way = {
  id: 7,
  nodes: [1, 2, 3, 4, 5, 6],
  geometry: [0, 100, 200, 300, 400, 500].map((x) => ll(x, 0)),
};
const centre = { lat: 51, lng: 13.7 + 250 / KX };

function world(fogVersion) {
  const fogMap = new FogParser.FogMap();
  const { corridorNewFrac } = gainOver(fogMap);
  const streets = new StreetIndex({ newFrac: corridorNewFrac, fogVersion: fogVersion || (() => fogMap.version) });
  streets._anchor(51);
  streets._addWay(way);
  streets.version++; // a fetch would have
  return { fogMap, streets };
}
// the cells a walk along the street reveals, as the page would add them
function walkAlongStreet() {
  const track = [];
  for (let x = 0; x <= 500; x += 10) track.push({ t: x * 1000, ...ll(x, 0), accuracy: 5 });
  return Reveal.reveal(track, Reveal.RULES);
}
const sum = (a) => a.reduce((s, v) => s + v, 0);

{ // newAreaM2 falls once the street's cells are revealed, with nobody telling the index: it reads the fog version itself
  const { fogMap, streets } = world();
  const before = streets.newAreaM2(centre, 400);
  assert.ok(before > 0, `before ${before}`);
  fogMap.addCells(walkAlongStreet());
  const after = streets.newAreaM2(centre, 400);
  assert.ok(after < before * 0.5, `after ${after} vs before ${before}`);
}
{ // the cached fractions are keyed on the fog version alone: while it does not move they stay
  const { fogMap, streets } = world(() => 0);
  const before = streets.newAreaM2(centre, 400);
  fogMap.addCells(walkAlongStreet());
  assert.equal(streets.newAreaM2(centre, 400), before);
}
{ // a fog change re-scores the segment without touching the version the planner stamps its graph with, so a held graph stays current
  const { fogMap, streets } = world();
  const planner = new GraphPlanner(streets, streets.newFrac, undefined, undefined, () => fogMap.version);
  const before = streets.newAreaM2(centre, 400);
  const v = streets.version;
  fogMap.addCells(walkAlongStreet());
  planner.build();
  planner.held = true;
  assert.ok(planner.isCurrent(), "built on the fog as it is");
  const after = streets.newAreaM2(centre, 400);
  assert.ok(after < before * 0.5, `${after} vs ${before}`);
  assert.equal(streets.version, v, "the index's version is not bumped by a fog change");
  assert.ok(planner.isCurrent(), "scoring a segment after the fog moved leaves the held graph current");
}
{ // an index built with no fog version never drops its fractions
  const streets = new StreetIndex({ newFrac: () => 1 });
  streets._anchor(51);
  streets._addWay(way);
  const before = streets.newAreaM2(centre, 400);
  assert.equal(streets.newAreaM2(centre, 400), before);
}
{ // a fog change makes the planner rebuild, and the rebuilt rewards use the new fog
  const { fogMap, streets } = world();
  const planner = new GraphPlanner(streets, streets.newFrac, undefined, undefined, () => fogMap.version);
  planner.build();
  const stamp = planner.builtStamp, reward = sum(planner.reward);
  assert.ok(reward > 0, `reward ${reward}`);
  planner.build();
  assert.equal(planner.builtStamp, stamp, "nothing changed: no rebuild");
  fogMap.addCells(walkAlongStreet());
  planner.build();
  assert.notEqual(planner.builtStamp, stamp);
  assert.ok(sum(planner.reward) < reward * 0.5, `reward ${sum(planner.reward)} vs ${reward}`);
}
{ // SuggestTool hands its planners the fog version: a reveal changes the rewards of the planner streetGraph hands out, without a new planner
  const { fogMap, streets } = world();
  const tool = new SuggestTool({}, { fogMap, streets, computeGain: () => null });
  const planner = tool.streetGraph();
  planner.build();
  const reward = sum(planner.reward);
  fogMap.addCells(walkAlongStreet());
  assert.equal(tool.streetGraph(), planner, "same planner, rebuilt in place");
  planner.build();
  assert.ok(sum(planner.reward) < reward * 0.5, `reward ${sum(planner.reward)} vs ${reward}`);
}
{ // clearing the overlay is a fog change as well: the reward comes back
  const { fogMap, streets } = world();
  const planner = new GraphPlanner(streets, streets.newFrac, undefined, undefined, () => fogMap.version);
  planner.build();
  const reward = sum(planner.reward);
  fogMap.addCells(walkAlongStreet());
  planner.build();
  fogMap.clearOverlay();
  planner.build();
  assert.ok(Math.abs(sum(planner.reward) - reward) < 1e-6, `reward ${sum(planner.reward)} vs ${reward}`);
}

{ // taking the overlay back is a fog change the index follows too: the area a reveal took away returns, with nobody telling it
  const { fogMap, streets } = world();
  const before = streets.newAreaM2(centre, 400);
  fogMap.addCells(walkAlongStreet());
  assert.ok(streets.newAreaM2(centre, 400) < before * 0.5);
  fogMap.clearOverlay();
  assert.ok(Math.abs(streets.newAreaM2(centre, 400) - before) < 1e-6, "scored on the fog as it is again");
}
console.log("fog-invalidate.test.js ok");
