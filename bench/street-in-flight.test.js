// The in-flight registry (streetInFlight.ts) at its own interface: claim, release, of, idle; no download around it.
//   node bench/street-in-flight.test.js
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createInFlight } = require(path.join(__dirname, "..", "app", "src", "streetInFlight.ts"));

const T = (x, y) => ({ x, y });
// what a promise settled with, once the chains have run
const settled = async (p) => { let got = "pending"; p.then((v) => { got = v; }); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); return got; };

(async () => {
  { // nothing is in flight until a run claims
    const f = createInFlight();
    assert.equal(f.idle(), true);
    assert.equal(f.of("548:2040"), undefined);
    const run = f.forRun();
    run.claim([T(548, 2040), T(549, 2040)]);
    assert.equal(f.idle(), false);
    assert.ok(f.of("548:2040") && f.of("549:2040"));
    assert.equal(f.of("550:2040"), undefined);
  }
  { // a release settles the entry with what the source said, takes it out, and is idle once every tile is given back
    const f = createInFlight();
    const run = f.forRun();
    run.claim([T(548, 2040), T(549, 2040)]);
    const a = f.of("548:2040"), b = f.of("549:2040");
    assert.equal(await settled(a.promise), "pending", "not settled while claimed");
    run.release("548:2040", { cached: true });
    assert.deepEqual(await settled(a.promise), { cached: true });
    assert.equal(f.of("548:2040"), undefined);
    assert.equal(f.idle(), false, "one tile still in flight");
    run.release("549:2040");
    assert.equal(await settled(b.promise), undefined, "given up: nothing said of it");
    assert.equal(f.idle(), true);
  }
  { // a second release, and a release of a tile the run never claimed, do nothing
    const f = createInFlight();
    const run = f.forRun();
    run.claim([T(548, 2040)]);
    const a = f.of("548:2040");
    run.release("548:2040", { cached: false });
    run.release("548:2040", { cached: true });
    assert.deepEqual(await settled(a.promise), { cached: false }, "the first release is the one that counts");
    assert.doesNotThrow(() => run.release("999:999"));
  }
  { // a run releases only its own claims: another run's entry for the same tile, claimed since, stays
    const f = createInFlight();
    const first = f.forRun(), second = f.forRun();
    first.claim([T(548, 2040)]);
    const old = f.of("548:2040");
    second.claim([T(548, 2040)]);
    const newer = f.of("548:2040");
    assert.notEqual(old, newer);
    first.release("548:2040");
    assert.equal(f.of("548:2040"), newer, "the first run's release leaves the second run's entry");
    assert.equal(await settled(old.promise), undefined);
    assert.equal(await settled(newer.promise), "pending");
    second.release("548:2040", { cached: true });
    assert.equal(f.idle(), true);
    assert.deepEqual(await settled(newer.promise), { cached: true });
  }
  { // a run that never claimed a tile cannot release another run's
    const f = createInFlight();
    const owner = f.forRun(), other = f.forRun();
    owner.claim([T(548, 2040)]);
    other.release("548:2040");
    assert.ok(f.of("548:2040"), "still in flight");
    assert.equal(await settled(f.of("548:2040").promise), "pending");
  }
  console.log("street-in-flight.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
