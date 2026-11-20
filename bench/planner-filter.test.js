// Given a usable-way predicate, the planner graph holds only the ways it allows; synthetic streets, no network.
//   node bench/planner-filter.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { GraphPlanner } = global;

const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
// the planner reads only the ways and the version of what it is given
const streets = { version: 0, ways: [
  { id: 10, nodes: [1, 2], geometry: [ll(0, 0), ll(500, 0)] },
  { id: 11, nodes: [2, 3], geometry: [ll(500, 0), ll(1000, 0)] }
] };
const refused = new Set([11]);

{ // the graph skips ways the predicate refuses, and edges remember their way
  const p = new GraphPlanner(streets, () => 1, (id) => !refused.has(id));
  p.build();
  assert.equal(p.edges.length, 1);
  assert.equal(p.edges[0].way, 10);
}
{ // with no predicate every way is held, and one-way tags do not bind walkers
  const st = { version: 0, ways: [{ id: 10, nodes: [1, 2], geometry: [ll(0, 0), ll(500, 0)] }] };
  const p = new GraphPlanner(st, () => 1);
  p.build();
  assert.equal(p.edges[0].dir, 0);
}
{ // distances run in the direction of travel: out along a one-way is finite, back is not
  const ow = { ways: [{ id: 10, nodes: [1, 2], geometry: [{ lat: 51, lon: 13.7 }, { lat: 51, lon: 13.71 }] }] };
  const p = new GraphPlanner(ow, () => 1, undefined, () => 1);
  p.build();
  const [n1, n2] = [0, 1];
  assert.ok(isFinite(p._plain(n1)[n2]), "1 -> 2 along the way");
  assert.ok(!isFinite(p._plain(n2)[n1]), "2 -> 1 against it");
  assert.ok(isFinite(p._plainTo(n2)[n1]), "1 can reach 2");
  assert.ok(!isFinite(p._plainTo(n1)[n2]), "2 cannot reach 1");
}
{ // a change in what the predicate refuses reaches the graph once the index's version moves
  const st = { version: 0, ways: [{ id: 10, nodes: [1, 2], geometry: [{ lat: 51, lon: 13.7 }, { lat: 51, lon: 13.71 }] }] };
  const gone = new Set();
  const p = new GraphPlanner(st, () => 1, (id) => !gone.has(id));
  p.build();
  assert.equal(p.edges.length, 1);
  gone.add(10);
  st.version++; // what ensureRects does when a fetch has been read
  p.build();
  assert.equal(p.edges.length, 0);
}
console.log("planner-filter.test.js ok");
