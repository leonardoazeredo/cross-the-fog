// Node-side loader for the browser app code + a Fog of World Sync/ folder.
// The app files are plain IIFEs over `window`, so we point window at globalThis
// and require them; pako is only needed by the browser (we inflate with zlib here).
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

global.window = global;
require("./leaflet-stub.js"); // defines global.L, which suggest.ts reads from the host when it draws
// the page's TypeScript modules (window.FogParser, MD5, FogWriter, FogZip, Reveal, Overpass, TileStore, StreetCache, StreetIndex, GraphPlanner, LocalRouter, RouteLocal, SuggestTool, StreetMessages, ImportMessages, Estimates, Elevation, Sha256, FogGain), which Node strips the types from itself
require(path.join(__dirname, "..", "..", "app", "src", "engine.ts"));
// bench/cache/ is keyed by request URL and query and holds overpass-api.de answers; asking that
// instance first keeps the benchmark on the same data as the saved baseline.
global.Overpass.setOrder(["main", "nextgis"]);
// the street cache (StreetCache, from the engine) sits between the street index and the network; the bench installs its own tile fetch and bypasses it

function loadSync(dir) {
  const fogMap = new global.FogParser.FogMap();
  let bad = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!fs.statSync(file).isFile()) continue;
    try {
      const data = zlib.inflateSync(fs.readFileSync(file));
      if (!fogMap.addTile(name, new Uint8Array(data))) bad++;
    } catch (e) { bad++; }
  }
  return { fogMap, bad };
}

// The fog gain the page builds in main.js, over a fog map the bench loaded.
function gainOver(fogMap) {
  return global.FogGain.create({ fogMap, worldCells: global.FogParser.WORLD_CELLS, lngLatToCell: global.FogParser.lngLatToCell });
}

module.exports = { loadSync, gainOver, FogParser: global.FogParser, SuggestTool: global.SuggestTool, StreetIndex: global.StreetIndex, L: global.L };
