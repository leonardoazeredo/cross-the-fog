// Street source for the bench: the query is built from the rects of the run's ensureRects call, not
// from the tiles, so it matches the entries in bench/cache/overpass/ when a scenario makes the same
// call; the answer is then split per tile and each tile handed to onTile, as the app's sources do.
"use strict";

// bench/cache/ holds overpass-api.de answers; asking that instance first keeps the bench on the same data
// as the saved baseline; the street source installed here is how a bench run posts to Overpass.
// Serves the rects of one ensureRects call per index: a later call that has to fetch for other rects would build a
// query whose text differs from the saved one (a cache miss), so it throws instead (SuggestTool reports that as an "internal" error, which bench/run.js counts and exits 1 for). A later call over rects that are
// already held fetches nothing. The query asks only for the rects, not the whole tiles they touch, so the index
// treats a whole tile as covered although streets outside the rects were not fetched: newAreaM2 can score a small
// area there where the app's own source (whole street blocks) would have found streets, so the bench's scores are
// not strictly the app's; the graphs, which read only the ways held, are the same.
function installTileFetch(streets) {
  global.Overpass.setOrder(["main", "nextgis"]);
  const ensureRects = streets.ensureRects.bind(streets);
  let rects = null, fetchedFor = null;
  streets.ensureRects = (r, opts) => { rects = r; return ensureRects(r, opts); };
  streets.fetchStreets = async (tiles, onTile) => {
    const key = JSON.stringify(rects);
    if (fetchedFor !== null && fetchedFor !== key) {
      throw new Error("bench/lib/tileFetch.js serves one set of rects per index: a second one would not match bench/cache/");
    }
    fetchedFor = key;
    const q = global.StreetIndex.rectQuery(rects);
    const answers = global.StreetIndex.splitAnswer(await global.Overpass.post("data=" + encodeURIComponent(q)), tiles);
    if (onTile) for (const t of tiles) onTile(t, answers.get(global.StreetIndex.tileId(t)));
    return answers;
  };
}

module.exports = { installTileFetch };
