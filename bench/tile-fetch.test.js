// bench/lib/tileFetch.js, the street source the bench installs: the query is the one rectQuery gives for the run's
// rects (bench/cache/ is keyed on that text), and a second set of rects that needs a fetch is refused rather than
// missing the cache. A fake Overpass.post: no network, no cache.
//   node bench/tile-fetch.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { installTileFetch } = require("./lib/tileFetch.js");
const { StreetIndex, Overpass } = global;

const A = [{ s: 51.0, w: 13.7, n: 51.01, e: 13.71 }];
const B = [{ s: 52.0, w: 14.7, n: 52.01, e: 14.71 }];

(async () => {
  const realPost = Overpass.post;
  const bodies = [];
  Overpass.post = async (body) => { bodies.push(body); return { elements: [{ type: "count" }] }; };
  try {
    const s = new StreetIndex({ newFrac: () => 1 });
    installTileFetch(s);
    assert.deepEqual(await s.ensureRects(A), { done: 1, total: 1 });
    assert.deepEqual(bodies, ["data=" + encodeURIComponent(StreetIndex.rectQuery(A))], "the query is the run's rects, not its tiles");
    assert.deepEqual(await s.ensureRects(A), { done: 1, total: 1 });
    assert.equal(bodies.length, 1, "the same rects again fetch nothing");
    const err = await s.ensureRects(B).then(() => null, (e) => e);
    assert.ok(err instanceof Error && /one set of rects per index/.test(err.message), "other rects that need a fetch are refused: " + (err && err.message));
    assert.equal(bodies.length, 1, "and nothing was posted for them");
  } finally { Overpass.post = realPost; Overpass._reset(); }
  { // the same rects again after a failed first fetch go out with the identical query: the guard refuses other rects, not a retry
    const posts = [];
    let fail = true;
    Overpass.post = async (body) => {
      posts.push(body);
      if (fail) throw Object.assign(new Error("x"), { reason: "busy" });
      return { elements: [{ type: "count" }] };
    };
    try {
      const s = new StreetIndex({ newFrac: () => 1 });
      installTileFetch(s);
      assert.ok(await s.ensureRects(A).then(() => null, (e) => e), "the first fetch fails");
      fail = false;
      assert.deepEqual(await s.ensureRects(A), { done: 1, total: 1 });
      assert.equal(posts.length, 2);
      assert.equal(posts[1], posts[0], "the retry asks the same query");
    } finally { Overpass.post = realPost; Overpass._reset(); }
  }
  console.log("tile-fetch.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
