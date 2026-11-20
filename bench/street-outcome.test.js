// StreetIndex.outcome: how a street download ended, sorted once; synthetic source, no network.
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

(async () => {
  // done: the counts of the run
  assert.deepEqual(await indexWith(answering).outcome(one), { kind: "done", done: 1, total: 1 });
  const held = indexWith(answering);
  await held.ensureRects(one);
  assert.deepEqual(await held.outcome(one), { kind: "done", done: 1, total: 1 }, "everything held is done, with no request");

  // failed: exactly what downloadFacts keeps, never the message
  const offline = await indexWith(failing(reason("offline"))).outcome(one);
  assert.deepEqual(offline, { kind: "failed", facts: { reason: "offline", done: 0, total: 1, retryAt: undefined, cause: { reason: "offline" } } });
  assert.ok(!JSON.stringify(offline).includes("273:1020"), "no server text");
  const busy = await indexWith(failing(reason("busy", { retryAt: 123456 }))).outcome(one);
  assert.deepEqual([busy.kind, busy.facts.reason, busy.facts.retryAt, busy.facts.cause], ["failed", "busy", 123456, { reason: "busy" }]);
  const partialSource = async (tiles, onTile) => { onTile(tiles[0], { ways: [], groups: {} }); throw reason("stalled"); };
  const partial = await indexWith(partialSource).outcome([{ s: 51.0, w: 13.7, n: 51.02, e: 13.76 }]);
  assert.deepEqual([partial.kind, partial.facts.reason, partial.facts.cause], ["failed", "streets-partial", { reason: "stalled" }]);

  // superseded: a newer run replaced this one; its own kind, with nothing else in it
  assert.deepEqual(await indexWith(answering).outcome(one, { stale: () => true }), { kind: "superseded" });

  // bug: the error itself, from a source with no street reason, a throw in a handler, or before a promise exists
  const boom = new TypeError("cannot read tile 273:1020");
  const bug = await indexWith(failing(boom)).outcome(one);
  assert.equal(bug.kind, "bug");
  assert.equal(bug.error, boom);
  const inProgress = await indexWith(answering).outcome(one, { onProgress: () => { throw boom; } });
  assert.deepEqual([inProgress.kind, inProgress.error], ["bug", boom]);
  const early = await sortOutcome(() => { throw boom; });
  assert.deepEqual([early.kind, early.error], ["bug", boom]);

  // a stale run's outcome is not folded: a failure or a bug in it keeps its kind, and the caller asks stale() itself
  const staleFailed = await indexWith(failing(reason("busy"))).outcome(one, { stale: () => false });
  assert.equal(staleFailed.kind, "failed");
  let stale = false;
  const staleBug = await indexWith(async () => { stale = true; throw boom; }).outcome(one, { stale: () => stale });
  assert.deepEqual([staleBug.kind, staleBug.error], ["bug", boom], "a bug thrown while the run turns stale is a bug");
  stale = false;
  const staleDownload = await indexWith(async () => { stale = true; throw reason("offline"); }).outcome(one, { stale: () => stale });
  assert.deepEqual(staleDownload, { kind: "superseded" }, "a download failure that lands once the run is stale is superseded already");

  // a stand-in that resolves with nothing is done; a run that resolves is never mistaken for a failure
  const nothing = await sortOutcome(async () => undefined);
  assert.equal(nothing.kind, "done");

  // outcome goes through the instance's ensureRects, as every other call of the index does
  const s = indexWith(answering);
  s.ensureRects = async () => { throw StreetIndex.downloadError(2, 5, { reason: "offline" }, 0); };
  const replaced = await s.outcome(one);
  assert.deepEqual([replaced.kind, replaced.facts.done, replaced.facts.total], ["failed", 2, 5]);

  // never rejects
  for (const thrown of [undefined, null, "text", 0, boom]) {
    const out = await sortOutcome(async () => { throw thrown; });
    assert.equal(out.kind, "bug");
    assert.equal(out.error, thrown);
  }
  console.log("street-outcome.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
