// Fog of World data for the bench: a Sync/ folder read into a FogMap, and the page's fog gain over it.
// Needs the engine loaded first (bench/lib/host.js, then app/src/engine.ts).
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

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

module.exports = { loadSync, gainOver };
