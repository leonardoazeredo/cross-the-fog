// StreetIndex: reading answers into the index; synthetic streets, no network.
//   node bench/streets-refresh.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { StreetIndex } = global;

// tile 548:2040 is lon 13.7-13.725, lat 51.0-51.025; 549:2040 is the next one east
const KX = 111320 * Math.cos(51 * Math.PI / 180), KY = 110540;
const ll = (x, y) => ({ lat: 51 + y / KY, lon: 13.7 + x / KX });
const west = { s: 51, w: 13.7, n: 51.025, e: 13.725 };
const both = { s: 51, w: 13.7, n: 51.025, e: 13.75 };
const way = (id, nodes, ...pts) => ({ id, nodes, geometry: pts.map(([x, y]) => ll(x, y)) });
const answer = (ways, groups) => ({ ways, groups: groups || {} });

// A source answering a run from `answers`, "x:y" -> answer.
function source(answers) {
  return async (tiles, onTile) => {
    const out = new Map();
    for (const t of tiles) {
      const k = t.x + ":" + t.y;
      out.set(k, answers[k]);
      onTile(t, answers[k]);
    }
    return out;
  };
}
const index = (answers) => new StreetIndex({ newFrac: () => 1, fetchStreets: source(answers) });
const wayIdsOf = (s) => s.ways.map((w) => w.id).sort();

(async () => {
  { // a way two tiles list is held once
    const s = index({ "548:2040": answer([way(1, [1, 2], [0, 100], [400, 100]), way(7, [70, 71], [200, 100], [1900, 100])], { bike: [1, 7] }), "549:2040": answer([way(7, [70, 71], [200, 100], [1900, 100])], { bike: [7] }) });
    await s.ensureRects([both]);
    assert.deepEqual(wayIdsOf(s), [1, 7]);
    // the same two ways read from one tile alone: a way listed twice adds no segments
    const one = index({ "548:2040": answer([way(1, [1, 2], [0, 100], [400, 100]), way(7, [70, 71], [200, 100], [1900, 100])]) });
    await one.ensureRects([west]);
    const at = ll(1000, 100);
    assert.ok(one.newAreaM2({ lat: at.lat, lng: at.lon }, 3000) > 0);
    assert.equal(s.newAreaM2({ lat: at.lat, lng: at.lon }, 3000), one.newAreaM2({ lat: at.lat, lng: at.lon }, 3000));
  }
  { // an answer that cannot be read whole still tells the graphs built before to rebuild
    const bad = { id: 1, nodes: [1, 2], geometry: [ll(0, 100), null] };
    const s = index({ "548:2040": answer([bad]) });
    const v = s.version;
    await assert.rejects(s.ensureRects([west]), TypeError);
    assert.ok(s.version > v);
  }
  console.log("streets-refresh.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
