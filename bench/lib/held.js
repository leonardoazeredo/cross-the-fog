// What a StreetIndex holds, seen only through its public covered(): the tiles under rects padded by
// one tile, so a tile covered beside the ones a run asked for shows too. Needs the engine loaded.
"use strict";

function heldAround(index, rects) {
  const { StreetIndex } = global;
  const pad = StreetIndex.TILE_DEG;
  const padded = rects.map((r) => ({ s: r.s - pad, w: r.w - pad, n: r.n + pad, e: r.e + pad }));
  return StreetIndex.tilesOf(padded)
    .filter((t) => {
      const b = StreetIndex.tileBounds(t);
      return index.covered((b.s + b.n) / 2, (b.w + b.e) / 2);
    })
    .map((t) => StreetIndex.tileId(t))
    .sort();
}

module.exports = { heldAround };
