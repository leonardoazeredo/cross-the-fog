// The fog gain module: what a line reveals, on a small fog map built cell by cell.
//   node bench/fog-gain.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/load.js");
const { gainOver } = require("./lib/load.js");
const { createFogGain, distanceM, DEFOG_HALF_M } = require("../app/src/fogGain.ts");
const { FogParser } = global;

assert.equal(DEFOG_HALF_M, 15);
assert.equal(global.FogGain.DEFOG_HALF_M, 15, "the page's window.FogGain is the same module");
assert.equal(global.FogGain.create, createFogGain);

// Leaflet's earth radius: a degree of latitude is R * pi / 180 metres, along any meridian
assert.ok(Math.abs(distanceM(10, 20, 11, 20) - (6371e3 * Math.PI) / 180) < 1e-6);
assert.equal(distanceM(51, 13.7, 51, 13.7), 0);
// symmetric, and the same either way round the antimeridian
assert.equal(distanceM(10, 179.9, 10, -179.9), distanceM(10, -179.9, 10, 179.9));
assert.ok(distanceM(10, 179.9, 10, -179.9) < 25000, "crosses the antimeridian the short way");

const LAT = 51, LON = 13.7;
const cell = (lon, lat) => { const c = FogParser.lngLatToCell(lon, lat); return [Math.floor(c.cx), Math.floor(c.cy)]; };
const visit = (fogMap, lon, lat, r) => {
  const [cx, cy] = cell(lon, lat);
  const cells = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) cells.push(cx + dx, cy + dy);
  fogMap.addCells(Int32Array.from(cells));
};
const stub = (visited) => ({ isVisitedCell: (cx, cy) => visited(cx, cy), hasFog: () => true });
const deps = (fogMap) => ({ fogMap, worldCells: FogParser.WORLD_CELLS, lngLatToCell: FogParser.lngLatToCell });

{ // no fog at all: nothing to compare against, a line scores null and a point is fully new
  const fogMap = new FogParser.FogMap();
  const g = gainOver(fogMap);
  assert.equal(g.computeGain([[LON, LAT], [LON + 0.001, LAT]]), null);
  assert.equal(g.newness({ lat: LAT, lng: LON }), 1);
  assert.equal(g.corridorNewFrac(LON, LAT), 1);
  assert.equal(g.cellIsNew(LON, LAT), true);
}
{ // cell size shrinks with the cosine of the latitude, at the grid's own width
  const g = createFogGain(deps(new FogParser.FogMap()));
  assert.ok(Math.abs(g.cellMetersAt(0) - 40075016.686 / FogParser.WORLD_CELLS) < 1e-12);
  assert.ok(Math.abs(g.cellMetersAt(60) / g.cellMetersAt(0) - 0.5) < 1e-12);
}
{ // a visited cell anywhere in the corridor makes a point old, and takes its share out of the fraction
  const g0 = createFogGain(deps(new FogParser.FogMap()));
  const r = Math.max(1, Math.round(DEFOG_HALF_M / g0.cellMetersAt(LAT)));
  const [cx, cy] = cell(LON, LAT);
  const one = createFogGain(deps(stub((x, y) => x === cx + r && y === cy - r)));
  assert.equal(one.cellIsNew(LON, LAT), false, "the corner of the stamp counts");
  const side = 2 * r + 1;
  assert.equal(one.corridorNewFrac(LON, LAT), 1 - 1 / (side * side));
  const far = createFogGain(deps(stub((x, y) => x === cx + r + 1 && y === cy)));
  assert.equal(far.cellIsNew(LON, LAT), true, "one cell past the stamp does not");
  assert.equal(far.corridorNewFrac(LON, LAT), 1);
}
{ // newness: the visited share of the 100 m window, clamped to 2..15 cells either side
  const fogMap = new FogParser.FogMap();
  visit(fogMap, LON, LAT, 1);
  const g = gainOver(fogMap);
  // at 51 degrees a cell is about 6 m, so 100 m is 17 cells and the window clamps to 15 either side: 31 x 31, 9 of them visited
  assert.equal(Math.round(100 / g.cellMetersAt(LAT)), 17);
  assert.equal(g.newness({ lat: LAT, lng: LON }), 1 - 9 / 961);
  // a visited cell 15 cells out is inside the window, one 16 out is not
  const [cx0, cy0] = cell(LON, LAT);
  const edge = (d) => createFogGain(deps(stub((x, y) => x === cx0 + d && y === cy0)));
  assert.equal(edge(15).newness({ lat: LAT, lng: LON }), 1 - 1 / 961);
  assert.equal(edge(16).newness({ lat: LAT, lng: LON }), 1);
  const all = createFogGain(deps(stub(() => true)));
  assert.equal(all.newness({ lat: LAT, lng: LON }), 0);
  const none = createFogGain(deps(stub(() => false)));
  assert.equal(none.newness({ lat: LAT, lng: LON }), 1);
  // with no fog loaded every cell reads as new, whatever the map would answer
  const noFog = createFogGain(deps({ isVisitedCell: () => true, hasFog: () => false }));
  assert.equal(noFog.newness({ lat: LAT, lng: LON }), 1);
  assert.equal(noFog.computeGain([[LON, LAT], [LON + 0.001, LAT]]), null);
}
{ // a line over untouched ground defogs its whole corridor; one over visited ground defogs nothing
  const fogMap = new FogParser.FogMap();
  visit(fogMap, LON - 0.1, LAT - 0.1, 1); // fog exists, far away
  const g = gainOver(fogMap);
  const line = [[LON, LAT], [LON + 0.0005, LAT], [LON + 0.001, LAT]];
  const out = g.computeGain(line);
  assert.equal(out.newPct, 100);
  const m = g.cellMetersAt(LAT);
  const r = Math.max(1, Math.round(DEFOG_HALF_M / m));
  assert.ok(out.area > 0 && Math.abs(out.area / (m * m) - Math.round(out.area / (m * m))) < 1e-6, "a whole number of cells");
  assert.ok(out.area >= (2 * r + 1) * (2 * r + 1) * m * m, "at least one stamp");

  const done = new FogParser.FogMap();
  for (const p of line) visit(done, p[0], p[1], 8);
  for (let t = 0; t <= 1; t += 0.05) visit(done, LON + 0.001 * t, LAT, 8);
  const none = gainOver(done).computeGain(line);
  assert.equal(none.area, 0);
  assert.equal(none.newPct, 0);
  assert.equal(gainOver(done).computeGain([[LON, LAT]]), null, "one point is no line");
}
{ // length share: the new part of a line that runs from visited ground onto fresh ground
  const fogMap = new FogParser.FogMap();
  const west = [LON, LAT], mid = [LON + 0.001, LAT], east = [LON + 0.002, LAT];
  for (let t = 0; t <= 1; t += 0.02) visit(fogMap, LON + 0.001 * t, LAT, 4);
  const out = gainOver(fogMap).computeGain([west, mid, east]);
  assert.ok(Math.abs(out.newPct - 50) < 1e-9, `${out.newPct}`);
  assert.ok(out.area > 0);
}
{ // area is the union of the stamps, each cell once, however many vertices overlap it
  const fogMap = new FogParser.FogMap();
  visit(fogMap, LON - 0.1, LAT - 0.1, 1); // fog exists, far away
  const g = gainOver(fogMap);
  const m = g.cellMetersAt(LAT);
  assert.equal(Math.round(DEFOG_HALF_M / m), 2, "a stamp is 5 x 5 cells at 51 degrees");
  const [cx, cy] = cell(LON, LAT);
  // vertices one cell apart along a row and the middle one is the one the cell size is taken from
  const line = [0, 1, 2, 3, 4, 5, 6].map((i) => FogParser.cellToLngLat(cx + i + 0.5, cy + 0.5));
  const pts = line.map((p) => [p.lng ?? p[0], p.lat ?? p[1]]);
  const union = new Set();
  for (let i = 0; i < 7; i++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) union.add(`${cx + i + dx},${cy + dy}`);
  assert.equal(union.size, 11 * 5);
  const out = g.computeGain(pts);
  const mMiddle = g.cellMetersAt(pts[3][1]); // the cell size at the middle vertex, as the page sizes it
  assert.equal(out.area, union.size * mMiddle * mMiddle);
  // the cell size comes from the middle vertex, so a line that climbs in latitude is sized there
  const tall = [[LON, LAT - 0.2], [LON, LAT], [LON, LAT + 0.2]];
  const t3 = g.computeGain(tall);
  const mMid = g.cellMetersAt(LAT);
  assert.ok(Math.abs(t3.area / (mMid * mMid) - Math.round(t3.area / (mMid * mMid))) < 1e-6, "sized at the middle vertex");
}
{ // the length share weighs each segment by its true length: a long new segment against a short visited one
  const fogMap = new FogParser.FogMap();
  const a = [LON, LAT], b = [LON + 0.002, LAT], c = [LON + 0.002, LAT + 0.0005]; // 140 m east, then 55 m north
  for (let t = 0; t <= 1; t += 0.02) visit(fogMap, b[0], LAT + 0.0005 * t, 3);
  const g = gainOver(fogMap);
  const d1 = distanceM(a[1], a[0], b[1], b[0]), d2 = distanceM(b[1], b[0], c[1], c[0]);
  assert.ok(Math.abs(g.computeGain([a, b, c]).newPct - (100 * d1) / (d1 + d2)) < 1e-9);
  assert.ok(d1 > 2 * d2, "the segments differ in length, so lat and lng cannot be swapped unseen");
}
{ // a segment counts as new by its midpoint: new in the middle, visited only at its end
  const fogMap = new FogParser.FogMap();
  const a = [LON, LAT], b = [LON + 0.002, LAT];
  visit(fogMap, b[0], b[1], 8); // about 48 m around the end, the midpoint is 70 m out
  assert.equal(gainOver(fogMap).computeGain([a, b]).newPct, 100);
}
{ // the corridor radius rounds, it does not truncate: at 53.3 degrees 15 m is 2.6 cells, a stamp of 7 x 7
  const g0 = createFogGain(deps(new FogParser.FogMap()));
  const lat = 53.3;
  assert.equal(Math.round(DEFOG_HALF_M / g0.cellMetersAt(lat)), 3);
  const [cx, cy] = cell(LON, lat);
  const three = createFogGain(deps(stub((x, y) => x === cx + 3 && y === cy)));
  assert.equal(three.cellIsNew(LON, lat), false);
  const four = createFogGain(deps(stub((x, y) => x === cx + 4 && y === cy)));
  assert.equal(four.cellIsNew(LON, lat), true);
}
console.log("fog-gain.test.js ok");
