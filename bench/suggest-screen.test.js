// What a finished suggestion run does on the screen side, pinned because the page and its cards depend on the
// order: the order of the emits, what exists when the card list is emitted
// (lines drawn, the best one selected, the map fitted once), the polyline styles, the card payload and what
// adopt() lets go of; synthetic streets, a recording Leaflet, no network.
//   node bench/suggest-screen.test.js
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

// a Leaflet that records what the tool draws, in order
function recorder() {
  const log = [], polys = [];
  global.L.polyline = (latlngs, o) => {
    const l = { latlngs, o, styles: [], map: null };
    l.addTo = (m) => { l.map = m; log.push(["addTo", polys.indexOf(l)]); return l; };
    l.setStyle = (s) => { l.styles.push(s); log.push(["style", polys.indexOf(l)]); return l; };
    polys.push(l);
    log.push(["polyline", o.color, o.weight]);
    return l;
  };
  global.L.latLngBounds = (a, b) => ({ pts: [a, b], extend(p) { this.pts.push(p); return this; } });
  const fits = [], removed = [];
  const map = global.fakeMap();
  map.fitBounds = (b, o) => { fits.push([b, o]); log.push(["fit"]); };
  map.removeLayer = (l) => { removed.push(l); log.push(["remove", polys.indexOf(l)]); };
  return { log, polys, fits, removed, map };
}

function build(mode, ways, rec, computeGain) {
  const emits = [];
  const tool = new SuggestTool(rec.map, {
    fogMap: { tileCount: 0, hasFog: () => false },
    computeGain: computeGain || (() => ({ area: 1, newPct: 100 })),
    isNew: () => true,
    streets: streetsWith(ways),
    // what the page sees at the moment of each emit
    onResults: (s) => emits.push({ raw: s, s: s && JSON.parse(JSON.stringify(s)), selected: tool.selected, lines: tool.lines.length, results: tool.results.length, polys: rec.polys.length, fits: rec.fits.length }),
  });
  tool.mode = mode;
  tool.a = pin(0, 0);
  if (mode === "p2p") tool.b = pin(1000, 0);
  return { tool, emits };
}
const go = (tool) => (tool.mode === "loop" ? tool.suggest({ distM: 3000, buffer: 0.15 }) : tool.suggest({ buffer: 0.15 }));
const COLORS = ["#ff2d55", "#ff4fa3", "#ff8c2d"];

(async () => {
  for (const mode of ["p2p", "loop"]) {
    const rec = recorder();
    const { tool, emits } = build(mode, mode === "loop" ? ring : street, rec);
    await go(tool);
    const last = emits[emits.length - 1];
    const n = last.s.list.length;
    assert.ok(n >= 1 && n <= 3, `${mode}: one to three results`);

    // the page is told there are no results first, before anything is drawn
    assert.equal(emits[0].s, null, `${mode}: the first emit is the null of clearResults`);
    assert.deepEqual([emits[0].lines, emits[0].polys], [0, 0], `${mode}: and nothing was drawn yet`);
    assert.equal(emits.filter((e) => e.s && e.s.list).length, 1, `${mode}: one card list per run`);
    assert.equal(emits.indexOf(last), emits.length - 1, `${mode}: and it is the last emit`);

    // at the moment the cards are emitted the lines exist, the best one is selected and the map is fitted
    assert.deepEqual([last.lines, last.results, last.polys, last.fits, last.selected], [n, n, 2 * n, 1, 0],
      `${mode}: lines drawn, best selected and the map fitted once before the cards`);
    assert.deepEqual(tool.results.map((c) => c.r.lenM / 1000), last.s.list.map((c) => c.km), `${mode}: the cards are the results in order`);

    // the polylines: a solid one for new ground, then a dashed one, per result, both on the map
    const draw = rec.log.filter((e) => e[0] === "polyline");
    assert.deepEqual(draw.map((e) => e.slice(1)), COLORS.slice(0, n).flatMap((c) => [[c, 4], [c, 3]]), `${mode}: solid then dashed per result, in colour order`);
    rec.polys.forEach((p, k) => {
      assert.equal(p.map, rec.map, `${mode}: polyline ${k} is on the map`);
      const i = k >> 1;
      assert.deepEqual(p.o, k % 2 === 0
        ? { color: COLORS[i], weight: 4, opacity: 0.65 }
        : { color: COLORS[i], weight: 3, opacity: 0.55, dashArray: "2 8", lineCap: "round" }, `${mode}: polyline ${k} options`);
      assert.equal(p.styles.length, 1, `${mode}: select(0) restyles each line once`);
      const sel = i === 0;
      assert.deepEqual(p.styles[0], k % 2 === 0
        ? { weight: sel ? 6 : 4, opacity: sel ? 0.95 : 0.65 }
        : { weight: sel ? 4.5 : 3, opacity: sel ? 0.9 : 0.55 }, `${mode}: polyline ${k} style after select(0)`);
    });
    const order = rec.log.map((e) => e[0]).join();
    assert.ok(order.indexOf("fit") > order.lastIndexOf("polyline") && order.indexOf("style") > order.indexOf("fit"), `${mode}: drawn, then fitted, then selected`);

    // fitBounds: padding 30, bounds over every vertex of every result, first vertex first
    const [bounds, opts] = rec.fits[0];
    assert.deepEqual(opts, { padding: [30, 30] }, `${mode}: fit padding`);
    const all = tool.results.flatMap((c) => c.r.coords.map((p) => [p[1], p[0]]));
    assert.deepEqual(bounds.pts, [all[0]].concat(all), `${mode}: bounds hold every vertex of every result`);

    // the payload of a card
    assert.deepEqual(Object.keys(last.raw.list[0]).sort(), ["area", "ascent", "color", "deltaKm", "descent", "isBase", "km", "newPct", "retracePct"], `${mode}: card fields`);
    assert.deepEqual(last.s.list.map((c) => c.color), COLORS.slice(0, n), `${mode}: card colours`);
    const refKm = mode === "p2p" ? last.s.baseKm : last.s.targetKm;
    last.s.list.forEach((c) => assert.equal(c.deltaKm, c.km - refKm, `${mode}: deltaKm is against the reference length`));

    // adopt: hands out the pins and the geometry, then lets go of the layers and tells the page
    const before = emits.length;
    const out = tool.adopt(0);
    assert.deepEqual(Object.keys(out).sort(), ["coords", "wps"], `${mode}: adopt gives pins and geometry`);
    assert.ok(rec.removed.length === rec.polys.length && rec.removed.every((l, k) => l === rec.polys[k]), `${mode}: every line removed, solid then dashed per result`);
    assert.equal(emits[before].s, null, `${mode}: and the page is told there are no results`);
    assert.deepEqual([tool.results.length, tool.lines.length, tool.selected], [0, 0, -1], `${mode}: and the tool is empty`);
  }

  { // nothing to show: no candidates, or none that defogs anything. Nothing is drawn, fitted or selected
    for (const [cands, gain, expect] of [
      [[], null, { empty: true, baseKm: 1 }],
      [[{ r: { coords: [[13.7, 51], [13.71, 51]], lenM: 100, legs: [] } }], () => ({ area: 0, newPct: 0 }), { empty: true, reason: "defogged", baseKm: 1 }],
    ]) {
      const rec = recorder();
      const { tool, emits } = build("p2p", street, rec, gain || undefined);
      tool.clearResults();
      emits.length = 0;
      tool._finish(tool._runId, cands, { baseKm: 1 });
      assert.deepEqual(emits.map((e) => e.s), [expect], "one empty state, with its reason");
      assert.deepEqual([rec.polys.length, rec.fits.length, tool.lines.length, tool.results.length, tool.selected], [0, 0, 0, 0, -1], "nothing drawn, fitted or selected");
    }
  }

  { // a replaced run returns at once: nothing is drawn, fitted or emitted
    const rec = recorder();
    const { tool, emits } = build("p2p", street, rec);
    const old = tool._runId;
    tool.clearResults();
    emits.length = 0;
    tool._finish(old, [{ r: { coords: [[13.7, 51], [13.71, 51]], lenM: 100, legs: [] } }], { baseKm: 1 });
    assert.deepEqual([emits.length, rec.polys.length, rec.fits.length], [0, 0, 0]);
  }
  console.log("suggest-screen: ok");
})().catch((e) => { console.error(e); process.exit(1); });
