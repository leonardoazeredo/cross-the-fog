// bench/compare.js passes and fails on the cases it names; hand-made result files, no network.
//   node bench/compare.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-"));
const ok = [[13.7, 51], [13.701, 51], [13.702, 51], [13.703, 51]];
const jump = [[13.7, 51], [13.701, 51], [13.715, 51], [13.716, 51]]; // ~1 km between two vertices
const scenario = (name, area, coords, ms = 100) => ({ scenario: name, ms, results: [{ areaKm2: area, km: 1, coords }] });
function run(base, cand, ref = []) {
  const [b, c, r] = [base, cand, ref].map((x, i) => { const f = path.join(dir, `f${i}${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify({ scenarios: x })); return f; });
  return spawnSync(process.execPath, [path.join(__dirname, "compare.js"), b, c, r]).status;
}
// compare.js scores only the scenarios bench/scenarios.js still runs
const [A, B] = require("./scenarios.js").map((s) => s.name);
const base = [scenario(A, 1, ok), scenario(B, 2, ok)];

assert.equal(run(base, [scenario(A, 0.95, ok), scenario(B, 1.9, ok)]), 0, "95% of the baseline passes");
assert.equal(run(base, [scenario(A, 0.5, ok), scenario(B, 1, ok)]), 1, "half the baseline fails");
assert.equal(run(base, [scenario(A, 1, jump), scenario(B, 2, ok)]), 1, "a 1 km vertex gap fails");
assert.equal(run(base, [scenario(A, 1, ok, 6000), scenario(B, 2, ok)]), 1, "a slow run fails");
assert.equal(run(base, [scenario(A, 1, ok), { scenario: B, empty: true, reason: "too-long" }]), 0, "a declined long loop is skipped, not scored");
assert.equal(run(base, [scenario(A, 1, ok), { scenario: B, empty: true, reason: "streets-fetch" }]), 1, "any other empty result scores zero");
assert.equal(run(base, [scenario(A, 1, ok)]), 1, "a current scenario the candidate lacks scores zero");
assert.equal(run(base.concat([scenario("removed-bike-50k", 3, ok)]), [scenario(A, 1, ok), scenario(B, 2, ok)]), 0,
  "a baseline scenario no longer in scenarios.js is skipped, not scored");
// a reference scenario is held to the threshold on its own, and does not move the loops' median
const AB = require("./scenarios.js").find((x) => x.mode === "p2p").name;
const loops = [scenario(A, 1, ok), scenario(B, 2, ok)], ref = [scenario(AB, 2, ok)];
assert.equal(run(base, loops.concat(scenario(AB, 1.9, ok)), ref), 0, "a reference scenario at 95% passes");
assert.equal(run(base, loops.concat(scenario(AB, 1, ok)), ref), 1, "a reference scenario at half fails although the loops pass");
assert.equal(run(base, loops.concat(scenario(AB, 2, jump)), ref), 1, "a reference scenario with a 1 km gap fails");
assert.equal(run(base, loops, ref), 1, "a reference scenario the candidate lacks scores zero");
assert.equal(run(base, [scenario(A, 0.5, ok), scenario(B, 1, ok), scenario(AB, 2, ok)], ref), 1, "the loops' median still fails alone");
// no reference file: one clear line and a non-zero exit, not a silent pass
const lone = path.join(dir, "lone.json");
fs.writeFileSync(lone, JSON.stringify({ scenarios: base }));
const missing = spawnSync(process.execPath, [path.join(__dirname, "compare.js"), lone, lone, path.join(dir, "none.json")], { encoding: "utf8" });
assert.equal(missing.status, 2, "a missing reference file fails");
assert.match(missing.stderr, /reference-onfoot walk-ab/, "and says how to measure it");
console.log("compare.test.js ok");
