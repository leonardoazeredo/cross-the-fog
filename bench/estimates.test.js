// Estimates: BRouter's distance, filtered ascent and walking time model, checked against BRouter's own
// figures for the committed responses in bench/fixtures/brouter/.
//   node bench/estimates.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
require("./lib/load.js");
const { Estimates } = global;
const { compare, profileOf, hasElevation, WALK_PROFILE, FIXTURE_TIME_TOLERANCE, FIXTURE_DIST_TOLERANCE, ASCENT_TOLERANCE_M } = require("./lib/brouterCheck.js");

const DIR = path.join(__dirname, "fixtures", "brouter");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
assert.ok(files.length >= 3, "fixtures present");

const worst = { distPct: 0, ascentDiffM: 0, timePct: 0 };
const ascentMatches = { 10: 0, 5: 0 };
let checked = 0;

for (const f of files) {
  const feature = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).features[0];
  assert.equal(profileOf(feature), WALK_PROFILE, `${f}: BRouter's walking profile in the track name`);
  assert.ok(hasElevation(feature), `${f}: elevations in the fixture`);

  const r = compare(Estimates, feature);
  assert.ok(r.distPct <= FIXTURE_DIST_TOLERANCE * 100, `${f}: distance ${r.est.distanceM} vs ${r.want.distanceM}`);
  assert.ok(r.timePct <= FIXTURE_TIME_TOLERANCE * 100, `${f}: time ${r.est.seconds} vs ${r.want.seconds}`);

  // BRouter filters with 5 m where its own elevation data is 1 arc second and with 10 m elsewhere,
  // node by node, so one constant cannot match every track: the fixture must match one of the two
  // and BRouter's figure must lie between them
  const hi = r.est.ascentM;
  const lo = compare(Estimates, feature, { ascentFilterM: 5 }).est.ascentM;
  for (const [m, got] of [[10, hi], [5, lo]]) if (Math.abs(got - r.want.ascentM) <= ASCENT_TOLERANCE_M) ascentMatches[m]++;
  assert.ok(Math.abs(hi - r.want.ascentM) <= ASCENT_TOLERANCE_M || Math.abs(lo - r.want.ascentM) <= ASCENT_TOLERANCE_M,
    `${f}: ascent ${hi} (10 m) or ${lo} (5 m) vs ${r.want.ascentM}`);
  assert.ok(r.want.ascentM >= hi - ASCENT_TOLERANCE_M && r.want.ascentM <= lo + ASCENT_TOLERANCE_M, `${f}: BRouter ascent between the two filters`);
  worst.distPct = Math.max(worst.distPct, r.distPct);
  worst.ascentDiffM = Math.max(worst.ascentDiffM, r.ascentDiffM);
  worst.timePct = Math.max(worst.timePct, r.timePct);
  checked++;
}
assert.equal(checked, files.length);

// the 10 m default matches every fixture; 5 m fits more local cache answers within 2 m but has
// twice the mean error there (estimates-cache.test.js prints both)
assert.ok(ascentMatches[10] === files.length, `10 m filter matches ${ascentMatches[10]} of ${files.length}`);

// distance: the cheap ruler on a meridian
{
  const d = Estimates.distanceM([13.4, 52.0], [13.4, 52.0 + 1000 / 111_200]);
  assert.ok(Math.abs(d - 1000) <= 1, `1 km on a meridian: ${d}`);
  assert.equal(Estimates.distanceM([13.4, 52.5], [13.4, 52.5]), 1, "a link is never shorter than 1 m");
}

// a missing elevation tile degrades to a flat section, never a throw
{
  const coords = [[13.4, 52.5], [13.401, 52.5], [13.402, 52.5], [13.403, 52.5]];
  const r = Estimates.estimate(coords, [null, 40, null, 42]);
  assert.ok(Number.isFinite(r.seconds) && r.seconds > 0);
  assert.deepEqual(r.coords.map((c) => c[2]), [40, 40, 40, 42], "leading null takes the first known value, later nulls carry forward");
  assert.equal(r.ascentM, 2);
  assert.equal(r.elevationKnown, 2, "the result says how many heights were real");
  const none = Estimates.estimate(coords, [null, null, null, null]);
  assert.deepEqual(none.coords.map((c) => c[2]), [0, 0, 0, 0], "all null is flat at 0");
  assert.equal(none.ascentM, 0);
  assert.equal(none.elevationKnown, 0);
  assert.equal(none.descentM, 0);
}

// ascent and descent are mirror images, so they differ by the net height change (up to the filter's buffer)
{
  const coords = Array.from({ length: 41 }, (_, i) => [13.4 + i * 0.0005, 52.5]);
  const z = coords.map((_, i) => 100 + 30 * Math.sin(i / 4));
  const r = Estimates.estimate(coords, z);
  assert.ok(r.ascentM > 0 && r.descentM > 0);
  assert.ok(Math.abs(r.ascentM - r.descentM - (z[z.length - 1] - z[0])) <= 10, "ascent - descent = net change within the buffer");
}

// a wobble refills the buffer instead of counting again: up 3, down 3, up 3, down 3 is one 3 m climb; a steady climb counts fully
{
  const coords = [0, 1, 2, 3, 4].map((i) => [13.4 + i * 0.0005, 52.5]);
  const wobble = Estimates.estimate(coords, [0, 3, 0, 3, 0]);
  assert.equal(wobble.ascentM, 3);
  assert.equal(wobble.descentM, 0, "the first 3 m descent is held in the buffer and the next rise cancels it");
  assert.equal(Estimates.estimate(coords, [0, 6, 12, 18, 24]).ascentM, 24);
  // the 20 m of drop beyond the filter is forgotten, so only 20 of the 30 m climb back counts
  assert.equal(Estimates.estimate(coords, [30, 0, 0, 0, 30]).ascentM, 20, "buffer saturates at -10: 30 m back up counts 20 m");
}

// uphill is slower than flat
{
  const coords = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [13.4 + i * 0.0005, 52.5]);
  const flat = Estimates.estimate(coords, coords.map(() => 50)).seconds;
  const up = Estimates.estimate(coords, coords.map((_, i) => 50 + i * 4)).seconds;
  assert.ok(up > flat * 1.2, `uphill ${up} vs flat ${flat}`);
}

// a time comes back for any valid line, heights or not
{
  const coords = [[13.4, 52.5], [13.41, 52.5]];
  for (const z of [[10, 12], [], null, undefined]) assert.ok(Number.isFinite(Estimates.estimate(coords, z).seconds), String(z));
}

// degenerate input
{
  assert.throws(() => Estimates.estimate([[13.4, 52.5], [NaN, 52.5]], [1, 2]), TypeError);
  assert.throws(() => Estimates.estimate([[13.4, 52.5], null], [1, 2]), TypeError);
  assert.throws(() => Estimates.estimate("not a list", []), TypeError, "coords must be an array");
  assert.throws(() => Estimates.estimate([[13.4, 52.5], [13.41, 52.5]], [1]), TypeError, "one height per point");
  assert.throws(() => Estimates.estimate([[13.4, 52.5], [13.41, 52.5]], "12"), TypeError, "heights must be an array");
  for (const bad of [0, -1, NaN, Infinity, "5"]) {
    assert.throws(() => Estimates.estimate([[13.4, 52.5], [13.41, 52.5]], [1, 2], { ascentFilterM: bad }), TypeError, `filter ${bad}`);
  }
  assert.ok(Estimates.estimate([[13.4, 52.5], [13.41, 52.5]], [1, 2], { ascentFilterM: 5 }), "a positive filter is fine");
  assert.ok(Estimates.estimate([[13.4, 52.5], [13.41, 52.5]], null), "no heights at all is allowed");
  const one = Estimates.estimate([[13.4, 52.5]], [10]);
  assert.deepEqual([one.distanceM, one.seconds, one.ascentM, one.descentM], [0, 0, 0, 0]);
  assert.deepEqual(Estimates.estimate([], []).coords, []);
}

// distance away from the fixtures' latitudes (51-56) and the longitude scale
{
  const at = (lat) => Estimates.distanceM([10, lat], [10 + 0.01, lat]);
  // one hundredth of a degree of longitude is 1113.2 m * cos(lat)
  for (const lat of [0, 30, 60, 80]) {
    const want = 1113.195 * Math.cos(lat * Math.PI / 180);
    assert.ok(Math.abs(at(lat) - want) <= Math.max(1, want * 0.005), `lat ${lat}: ${at(lat)} vs ${want.toFixed(1)}`);
  }
  assert.ok(Math.abs(Estimates.distanceM([-70, -33.5], [-70, -33.5 + 0.01]) - 1111) <= 2, "southern hemisphere, a hundredth of a degree of latitude");
  assert.equal(Estimates.distanceM([10, 30], [10.01, 30]), Estimates.distanceM([-10.01, 30], [-10, 30]), "the scale does not depend on the longitude");
}

// a long steep descent: the descent filter keeps its figure
{
  const coords = Array.from({ length: 21 }, (_, i) => [13.4 + i * 0.001, 52.5]);
  const r = Estimates.estimate(coords, coords.map((_, i) => 400 - i * 8)); // about 7 % grade
  assert.equal(r.ascentM, 0);
  assert.equal(r.descentM, 160, "a steady 160 m drop counts fully");
}

// the pieces the route editor and suggestions share
{
  assert.deepEqual(Estimates.climb([0, 3, 0, 3, 0]), { ascentM: 3, descentM: 0 }, "the filtered climb without a line");
  assert.deepEqual(Estimates.climb([30, 0, 0, 0, 30], { ascentFilterM: 10 }), { ascentM: 20, descentM: 30 });
  assert.deepEqual(Estimates.climb([]), { ascentM: 0, descentM: 0 });
  const coords = [[13.4, 52.5], [13.401, 52.5], [13.402, 52.5]];
  const withHeights = Estimates.estimate(coords, [10, 12, 15]);
  const s = Estimates.routeStats(withHeights);
  assert.deepEqual(s, { km: withHeights.distanceM / 1000, seconds: withHeights.seconds, ascent: 5, descent: 0 });
  const noHeights = Estimates.routeStats(Estimates.estimate(coords, []));
  assert.equal(noHeights.ascent, null, "no height arrived: the climb is unknown, not 0");
  assert.equal(noHeights.descent, null);
  assert.ok(noHeights.km > 0 && noHeights.seconds > 0);
}

console.log(`largest deviations over ${checked} fixtures: distance ${worst.distPct.toFixed(3)} %, ascent ${worst.ascentDiffM} m, time ${worst.timePct.toFixed(2)} %`);
console.log(`ascent filter: 10 m matches ${ascentMatches[10]}/${checked}, 5 m matches ${ascentMatches[5]}/${checked}`);
console.log("estimates.test.js ok");
