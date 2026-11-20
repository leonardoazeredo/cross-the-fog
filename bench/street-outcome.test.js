// sortOutcome: how a street download ended, sorted once; synthetic source, no network.
//   node bench/street-outcome.test.js
"use strict";
const assert = require("node:assert/strict");
require("./lib/host.js");
require("../app/src/engine.ts");
const { StreetIndex } = global;
const { sortOutcome } = require("../app/src/streetDownload.ts");

const one = [{ s: 51.0, w: 13.7, n: 51.02, e: 13.72 }];
const answering = async (tiles, onTile) => {
  const got = new Map();
  for (const t of tiles) {
    const a = { ways: [], groups: {} };
    onTile(t, a);
    got.set(StreetIndex.tileId(t), a);
  }
  return got;
};
const failing = (err) => async () => { throw err; };
const reason = (r, extra) => Object.assign(new Error("server remark: tile 273:1020"), { reason: r }, extra);
const indexWith = (fetchStreets) => new StreetIndex({ newFrac: () => 1, fetchStreets });
// what the callers do: the run's own ensureRects, and its stale() given to the sorter
const outcomeOf = (index, rects, opts) => sortOutcome(() => index.ensureRects(rects, opts), opts && opts.stale);

(async () => {
  // done: the counts of the run
  assert.deepEqual(await outcomeOf(indexWith(answering), one), { kind: "done", done: 1, total: 1, stale: false });
  const held = indexWith(answering);
  await held.ensureRects(one);
  assert.deepEqual(await outcomeOf(held, one), { kind: "done", done: 1, total: 1, stale: false }, "everything held is done, with no request");

  // failed: exactly what downloadFacts keeps, never the message
  const offline = await outcomeOf(indexWith(failing(reason("offline"))), one);
  assert.deepEqual(offline, { kind: "failed", facts: { reason: "offline", done: 0, total: 1, retryAt: undefined, cause: { reason: "offline" } } });
  assert.ok(!JSON.stringify(offline).includes("273:1020"), "no server text");
  const busy = await outcomeOf(indexWith(failing(reason("busy", { retryAt: 123456 }))), one);
  assert.deepEqual([busy.kind, busy.facts.reason, busy.facts.retryAt, busy.facts.cause], ["failed", "busy", 123456, { reason: "busy" }]);
  const partialSource = async (tiles, onTile) => { onTile(tiles[0], { ways: [], groups: {} }); throw reason("stalled"); };
  const partial = await outcomeOf(indexWith(partialSource), [{ s: 51.0, w: 13.7, n: 51.02, e: 13.76 }]);
  assert.deepEqual([partial.kind, partial.facts.reason, partial.facts.cause], ["failed", "streets-partial", { reason: "stalled" }]);

  // superseded: a newer run replaced this one; its own kind, with nothing else in it
  assert.deepEqual(await outcomeOf(indexWith(answering), one, { stale: () => true }), { kind: "superseded" });

  // bug: the error itself, from a source with no street reason, a throw in a handler, or before a promise exists
  const boom = new TypeError("cannot read tile 273:1020");
  const bug = await outcomeOf(indexWith(failing(boom)), one);
  assert.equal(bug.kind, "bug");
  assert.equal(bug.error, boom);
  const inProgress = await outcomeOf(indexWith(answering), one, { onProgress: () => { throw boom; } });
  assert.deepEqual([inProgress.kind, inProgress.error], ["bug", boom]);
  const early = await sortOutcome(() => { throw boom; });
  assert.deepEqual([early.kind, early.error], ["bug", boom]);

  // stale() is asked once, after the run ended. A bug keeps its kind and the flag; a download failure while stale is
  // superseded (ensureRects already says so when it noticed, the sorter covers a flip after its last look)
  let stale = false;
  const staleBug = await outcomeOf(indexWith(async () => { stale = true; throw boom; }), one, { stale: () => stale });
  assert.deepEqual([staleBug.kind, staleBug.error, staleBug.stale], ["bug", boom, true], "a bug thrown while the run turns stale is a bug, flagged");
  const liveBug = await outcomeOf(indexWith(failing(boom)), one, { stale: () => false });
  assert.deepEqual([liveBug.kind, liveBug.stale], ["bug", false]);

  // a stand-in that resolves with nothing is done; a run that resolves is never mistaken for a failure
  const nothing = await sortOutcome(async () => undefined);
  assert.equal(nothing.kind, "done");

  // a download failure of a stale request: nothing is shown or logged for it
  {
    const logged = [], orig = console.warn;
    console.warn = (...a) => logged.push(a);
    const streets = { ensureRects: async () => { throw StreetIndex.downloadError(0, 2, { reason: "offline" }); } };
    const route = global.RouteLocal.create({ streets, streetGraph: () => null, elevation: {}, estimates: {} });
    const pt = (lng) => ({ lat: 51.0, lng });
    const gone = await route([pt(13.7), pt(13.71)], () => {}, () => true);
    const shown = await route([pt(13.7), pt(13.71)], () => {}, () => false);
    console.warn = orig;
    assert.equal(gone.why.reason, "superseded");
    assert.deepEqual([shown.why.reason, shown.why.download.reason], ["streets-fetch", "offline"]);
    assert.deepEqual(logged, [["[route] streets unavailable", "offline"]], "only the request nobody replaced logs");
  }

  // the callers' other rows through a stand-in `streets`: what is logged, emitted and returned, for a superseded run
  // (nothing, on either console method), a bug on a request nobody replaced, and a thrown null
  {
    const logged = [], origErr = console.error, origWarn = console.warn;
    console.error = (...a) => logged.push(["error", ...a]);
    console.warn = (...a) => logged.push(["warn", ...a]);
    const supersededRun = () => StreetIndex.downloadError(0, 2, { reason: "superseded" });
    const route = (ensureRects, stale) => global.RouteLocal.create({ streets: { ensureRects }, streetGraph: () => null, elevation: {}, estimates: {} })(
      [{ lat: 51.0, lng: 13.7 }, { lat: 51.0, lng: 13.71 }], () => {}, stale);
    const load = async (ensureRects, stale) => {
      const emitted = [];
      const kept = await global.SuggestTool.prototype._loadStreets.call({ streets: { ensureRects } }, one, (s) => emitted.push(s), stale);
      return [kept, emitted];
    };
    try {
      assert.equal((await route(async () => { throw supersededRun(); }, () => false)).why.reason, "superseded");
      assert.deepEqual(await load(async () => { throw supersededRun(); }, () => false), [false, []]);
      assert.deepEqual(logged, [], "a superseded run logs nothing on either console method");

      const internal = await route(async () => { throw boom; }, () => false);
      assert.equal(internal.why.reason, "internal", "a bug on a request nobody replaced is internal, not superseded");
      assert.deepEqual(await load(async () => { throw boom; }, () => false), [false, [{ error: true, reason: "internal" }]]);
      assert.deepEqual(logged, [["error", "[route] reading streets threw", "TypeError"], ["error", "[suggest] reading streets threw", "TypeError"]]);

      logged.length = 0;
      assert.equal((await route(async () => { throw null; }, () => false)).why.reason, "internal");
      assert.deepEqual(await load(async () => { throw null; }, () => false), [false, [{ error: true, reason: "internal" }]]);
      assert.deepEqual(logged, [["error", "[route] reading streets threw", null], ["error", "[suggest] reading streets threw", undefined]]);
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }
  }

  // the caller table's six rows, at the sorter with a stale flag: [row, what ensureRects does, stale(), expected outcome]
  const dl = (r) => StreetIndex.downloadError(0, 2, { reason: r });
  const rows = [
    [1, async () => ({ done: 2, total: 2 }), false, { kind: "done", done: 2, total: 2, stale: false }],
    [1, async () => ({ done: 2, total: 2 }), true, { kind: "done", done: 2, total: 2, stale: true }],
    [2, failing(dl("superseded")), false, { kind: "superseded" }],
    [3, failing(boom), false, { kind: "bug", error: boom, stale: false }],
    [4, failing(boom), true, { kind: "bug", error: boom, stale: true }],
    [5, failing(dl("offline")), false, { kind: "failed", facts: { reason: "offline", done: 0, total: 2, retryAt: undefined, cause: { reason: "offline" } } }],
    [6, failing(dl("offline")), true, { kind: "superseded" }],
  ];
  for (const [row, run, isStale, want] of rows) {
    assert.deepEqual(await sortOutcome(run, () => isStale), want, "row " + row + (isStale ? ", stale" : ""));
  }
  // no stale() given: never stale
  assert.deepEqual(await sortOutcome(failing(dl("offline"))), rows[5][3]);
  // stale() is asked once, and not at all for a superseded run
  for (const [run, asked] of [[async () => ({}), 1], [failing(boom), 1], [failing(dl("offline")), 1], [failing(dl("superseded")), 0]]) {
    let calls = 0;
    await sortOutcome(run, () => { calls++; return false; });
    assert.equal(calls, asked);
  }
  // a stale() that throws is a bug of its own, shown (stale: false), whatever the run did
  const bad = new RangeError("stale broke");
  for (const run of [async () => ({}), failing(boom), failing(dl("offline"))]) {
    const out = await sortOutcome(run, () => { throw bad; });
    assert.deepEqual([out.kind, out.error, out.stale], ["bug", bad, false]);
  }

  // RouteLocal after a finished run asks stale() once: a request replaced meanwhile still routes (route.js drops the
  // result), one whose stale() throws is internal
  {
    const origErr = console.error;
    const seen = [];
    console.error = (...a) => seen.push(a);
    try {
      const streets = { ensureRects: async () => ({ done: 1, total: 1 }) };
      const route = (stale) => global.RouteLocal.create({ streets, streetGraph: () => null, elevation: {}, estimates: {} })(
        [{ lat: 51.0, lng: 13.7 }, { lat: 51.0, lng: 13.71 }], () => {}, stale);
      assert.equal((await route(() => true)).why.reason, "no-street-data", "stale after done carries on, as before");
      assert.equal((await route(() => { throw bad; })).why.reason, "internal", "a throwing stale() after done is internal (it was unobserved)");
      assert.deepEqual(seen, [["[route] reading streets threw", "RangeError"]]);
    } finally {
      console.error = origErr;
    }
  }

  // never rejects
  for (const thrown of [undefined, null, "text", 0, boom]) {
    const out = await sortOutcome(async () => { throw thrown; });
    assert.equal(out.kind, "bug");
    assert.equal(out.error, thrown);
  }
  console.log("street-outcome.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
