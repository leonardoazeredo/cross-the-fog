// Run the app's SuggestTool headless: no map and no Leaflet (plain pins, nothing drawn), cached fetch.
// Resolves with the tool's final results plus request/timing counters.
"use strict";
require("./host.js");
require("../../app/src/engine.ts");
const { SuggestTool, StreetIndex } = global;
const { overlapFrac } = SuggestTool._internals;
const cache = require("./fetch-cache.js");
const { installTileFetch } = require("./tileFetch.js");

function pin(lat, lng) { const ll = { lat, lng }; return { getLatLng: () => ll }; }

// scenario: { mode, a:[lat,lng], b?, distM?, targetM? (p2p wanted distance), buffer, noStreets? }
function runSuggest(fogMap, gain, scenario) {
  cache.install();
  const streets = scenario.noStreets ? null : new StreetIndex({ newFrac: gain.corridorNewFrac, fogVersion: () => fogMap.version });
  if (streets) installTileFetch(streets);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const emits = []; // every state the run handed the page, in order: the progress phases and the final card list
    cache.resetCounters();
    const tool = new SuggestTool({}, {
      fogMap,
      computeGain: gain.computeGain,
      newness: gain.newness,
      isNew: gain.cellIsNew,
      streets,
      onResults: (s) => {
        emits.push(s ? JSON.parse(JSON.stringify(s)) : s);
        if (!s || s.loading) return;
        const c = cache.counters();
        resolve({
          state: s,
          emits,
          results: tool.results.map((r) => ({
            coords: r.r.coords, lenM: r.r.lenM, gain: r.gain, isBase: !!r.isBase,
            adoptWps: r.adoptWps.map((w) => [w.lat, w.lng]),
            retracePct: Math.round(100 * overlapFrac(r.r.coords, false)),
            areaPerKm: r.gain.area / (r.r.lenM / 1000)
          })),
          requests: c.hits + c.misses, cacheHits: c.hits, ms: Date.now() - t0
        });
      }
    });
    tool._draw = () => {}; // the run's cards are emitted as always; only the preview lines and the fit need a map
    tool.mode = scenario.mode;
    tool.a = pin(scenario.a[0], scenario.a[1]);
    if (scenario.b) tool.b = pin(scenario.b[0], scenario.b[1]);
    tool.suggest({ distM: scenario.distM, targetM: scenario.targetM, buffer: scenario.buffer || 0.15 })
      .catch(reject);
    const guard = setTimeout(() => reject(new Error("suggest timed out")), 600000);
    guard.unref(); // don't hold the process open after results resolve
  });
}

module.exports = { runSuggest };
