// bench/identical.js: what it calls identical, what it refuses, and that it never prints a recorded value;
// synthetic recordings only.
//   node bench/identical.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identical-"));
const SECRET = 13.7123456; // stands for a recorded coordinate
const run = (scenarios) => ({ date: "d", scenarios });
const sc = (name, extra) => Object.assign({ scenario: name, ms: 1, results: [{ coords: [[SECRET, 51.5]] }] }, extra);
const put = (name, body) => {
  const f = path.join(dir, `${name}.json`);
  fs.writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
  return f;
};
const ident = (...a) => spawnSync("node", [path.join(__dirname, "identical.js"), ...a], { encoding: "utf8" });
const out = (r) => r.stdout + r.stderr;

try {
  const base = put("base", run([sc("a"), sc("b")]));
  const same = put("same", run([sc("a"), sc("b")]));
  assert.equal(ident(base, same).status, 0, "equal recordings are identical");

  const slower = put("slower", run([sc("a", { ms: 99 }), sc("b")]));
  const diff = ident(base, slower);
  assert.equal(diff.status, 1, "a differing value is a difference");
  assert.match(diff.stdout, /differs: scenario\.ms \(1\)/);
  assert.equal(ident(base, slower, "--exclude=ms").status, 0, "unless the field is excluded by name");

  const moved = put("moved", run([sc("a", { results: [{ coords: [[SECRET + 0.00001, 51.5]] }] }), sc("b")]));
  assert.equal(ident(base, moved, "--exclude=ms").status, 1, "a moved coordinate is a difference");
  assert.ok(!out(ident(base, moved)).includes("13.71"), "and no value is printed");

  const extra = put("extra", run([sc("a", { adopt: [1] }), sc("b")]));
  assert.equal(ident(base, extra).status, 1, "a field only the candidate has is a difference");
  assert.equal(ident(base, extra, "--subset").status, 0, "unless --subset");
  assert.equal(ident(extra, base, "--subset").status, 1, "and never the other way round");

  const missing = put("missing", run([sc("a")]));
  assert.equal(ident(base, missing).status, 1, "a missing scenario is a difference");
  assert.equal(ident(missing, base).status, 1, "and so is one only the candidate has");
  assert.equal(ident(missing, base, "--subset").status, 0, "unless --subset");
  assert.equal(ident(base, missing, "--subset").status, 1, "also with --subset");

  assert.equal(ident(put("none", run([])), put("none2", run([]))).status, 1, "nothing compared is not identical");
  assert.equal(ident(base, same, "--exclud=ms").status, 2, "a misspelt flag is refused, not ignored");
  assert.equal(ident(base).status, 2, "one file is a usage error");

  const dup = put("dup", run([sc("a"), sc("a")]));
  assert.equal(ident(base, dup).status, 2, "two scenarios of one name are refused");

  const broken = put("broken", `{"scenarios":[{"scenario":"a","coords":[[x${SECRET},51.5]]}]}`);
  const bad = ident(base, broken);
  assert.equal(bad.status, 2, "a file that is not JSON is refused");
  assert.match(bad.stderr, /not readable JSON \(SyntaxError\)/, "saying only the error class");
  assert.ok(!out(bad).includes("13.71") && !out(bad).includes("51.5"), "without printing its text");
  assert.equal(ident(base, put("noscen", { x: 1 })).status, 2, "a file with no scenarios list is refused");
  assert.equal(ident(base, put("objscen", { scenarios: {} })).status, 2, "so is one whose scenarios are not a list");
  console.log("identical.test.js ok");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
