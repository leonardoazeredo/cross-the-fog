// Dragging a pin hands the waypoint list the pin's new position, and still re-routes once; Leaflet stub, no network.
//   node bench/route-drag.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("./lib/leaflet-stub.js"); // this test draws on a fake map or builds the route editor
require("../app/src/engine.ts");
require("../app/src/route.js");
const { RouteTool, L } = global;

const handlers = [];
L.marker = (ll) => {
  const m = { _ll: ll, handlers: {}, addTo: () => m, setIcon: () => m, getLatLng: () => m._ll, on: (ev, fn) => { m.handlers[ev] = fn; return m; } };
  handlers.push(m);
  return m;
};

const lists = [];
const tool = new RouteTool(global.fakeMap(), { onWaypoints: (l) => lists.push(l.map((p) => [p.lat, p.lng])) });
let recalcs = 0;
tool._recalc = () => { recalcs++; };
tool.add(L.latLng(51, 13.7));
tool.add(L.latLng(51, 13.71));
lists.length = 0;
recalcs = 0;

handlers[1]._ll = L.latLng(51.002, 13.715);
handlers[1].handlers.dragend();
assert.deepEqual(lists, [[[51, 13.7], [51.002, 13.715]]], "the list is given the dragged pin's new position, once");
assert.equal(recalcs, 1, "the drag still asks for one route");
console.log("route-drag.test.js ok");
