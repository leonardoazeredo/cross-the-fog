// Run the CURRENT suggestion algorithm headless over bench/scenarios.js and
// report defog + shape metrics per suggestion card.
//   node bench/run.js [outName] [scenarioFilter]
// Overpass responses are disk-cached (bench/cache/), so re-runs are free and
// reproducible; delete the cache to re-measure against the live server.
"use strict";
const fs = require("fs");
const path = require("path");
require("./lib/host.js");
require("../app/src/engine.ts");
const { loadSync, gainOver } = require("./lib/fog.js");
const { runSuggest } = require("./lib/headless.js");
const { elongation, overlapFrac } = require("./lib/metrics.js");
const scenarios = require("./scenarios.js");

const outName = process.argv[2] || "baseline";
const filter = process.argv[3] || "";

(async () => {
  const { fogMap } = loadSync(path.join(__dirname, "..", "Sync"));
  const gain = gainOver(fogMap);
  console.log(`fog tiles: ${fogMap.tileCount}`);
  const all = [];
  let live = 0; // requests the disk cache did not have, over the scenarios that returned
  // scenarios that threw (their requests are not counted) or whose run ended in reason "internal" (SuggestTool turns a
  // throw it cannot class, such as tileFetch's refusal of a second set of rects, into that state instead of rejecting;
  // its requests are counted like any other returned run)
  let failed = 0;

  for (const sc of scenarios) {
    if (filter && !sc.name.includes(filter)) continue;
    process.stdout.write(`\n== ${sc.name} (${sc.note}) target ${(sc.distM || 0) / 1000 || "p2p"} km\n`);
    let out;
    try {
      out = await runSuggest(fogMap, gain, sc);
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
      all.push({ scenario: sc.name, error: e.message });
      failed++;
      continue;
    }
    live += out.requests - out.cacheHits;
    const s = out.state;
    if (s.error && s.reason === "internal") failed++;
    if (s.empty || s.error) {
      console.log(`  no results (${s.error ? "error" : s.reason || "empty"})  requests=${out.requests} (${out.cacheHits} cached) ${out.ms}ms`);
      all.push({ scenario: sc.name, empty: true, reason: s.reason || (s.error ? "error" : "empty"), requests: out.requests, ms: out.ms });
      continue;
    }
    const rows = out.results.map((r, i) => ({
      rank: i + 1,
      km: +(r.lenM / 1000).toFixed(2),
      areaKm2: +(r.gain.area / 1e6).toFixed(4),
      m2PerM: +(r.gain.area / r.lenM).toFixed(2),
      newPct: +r.gain.newPct.toFixed(1),
      overlapPct: +(overlapFrac(r.coords) * 100).toFixed(0),
      elong: +elongation(r.coords).toFixed(2),
      base: r.isBase || false
    }));
    console.table(rows);
    console.log(`  requests=${out.requests} (${out.cacheHits} cached)  ${out.ms}ms`);
    all.push({
      scenario: sc.name, note: sc.note, requests: out.requests, cacheHits: out.cacheHits, ms: out.ms,
      emits: out.emits,
      results: out.results.map((r, i) => Object.assign({}, rows[i], {
        coords: r.coords.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]),
        adoptWps: r.adoptWps.map((w) => [+w[0].toFixed(6), +w[1].toFixed(6)])
      }))
    });
  }

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, outName + ".json");
  fs.writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), scenarios: all }, null, 1));
  console.log(`\nwrote ${file}`);
  console.log(`live Overpass requests: ${live}`);
  console.log(`scenarios that threw: ${failed}`);
  // a miss is a new or cleared cache, or a changed query text: check StreetIndex.rectQuery before refetching;
  // BENCH_ALLOW_LIVE=1 is for the run that fills a cleared cache on purpose
  if (live && !process.env.BENCH_ALLOW_LIVE) process.exitCode = 1;
  if (failed) process.exitCode = 1;
})();
