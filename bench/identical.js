// Exact diff of two bench/run.js outputs: what a move that must not change a suggestion is held to.
//   node bench/identical.js <reference.json> <candidate.json> [--exclude=a,b] [--subset]
// Every field of the reference must equal the candidate's; --subset lets the candidate hold fields the reference
// lacks (a run recorded before a field was added). --exclude names fields skipped wherever they occur, for the ones
// that differ between two runs of the same code. The output is counts and field names only: the recorded values
// derive from the Sync/ folder and go in no log, fixture or report.
// Exit: 0 identical, 1 differ, 2 usage.
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const flag = (n) => args.find((a) => a.startsWith(`--${n}`));
const exclude = new Set(((flag("exclude=") || "").split("=")[1] || "").split(",").filter(Boolean));
const subset = args.includes("--subset");
if (files.length !== 2) {
  console.error("usage: node bench/identical.js <reference.json> <candidate.json> [--exclude=a,b] [--subset]");
  process.exit(2);
}
const [ref, cand] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));

// differing field name -> how many places it differs; array indexes are left out of the name
const differ = new Map();
let compared = 0;
const note = (field) => differ.set(field, (differ.get(field) || 0) + 1);

function walk(a, b, field) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return note(field);
    a.forEach((x, i) => walk(x, b[i], field));
  } else if (a && typeof a === "object") {
    if (!b || typeof b !== "object" || Array.isArray(b)) return note(field);
    for (const k of Object.keys(a)) if (!exclude.has(k)) walk(a[k], b[k], `${field}.${k}`);
    if (!subset) for (const k of Object.keys(b)) if (!exclude.has(k) && !(k in a)) note(`${field}.${k}`);
  } else {
    compared++;
    if (a !== b) note(field);
  }
}

// scenarios are matched by name, so a missing or added one is a difference rather than a shifted comparison
const byName = (run) => new Map(run.scenarios.map((s) => [s.scenario, s]));
const a = byName(ref), b = byName(cand);
for (const [name, s] of a) {
  if (!b.has(name)) note("scenario missing");
  else walk(s, b.get(name), "scenario");
}
if (!subset) for (const name of b.keys()) if (!a.has(name)) note("scenario added");

console.log(`scenarios: ${a.size} reference, ${b.size} candidate; values compared: ${compared}; excluded fields: ${[...exclude].join(",") || "none"}`);
if (differ.size) {
  for (const [field, n] of [...differ].sort()) console.log(`differs: ${field} (${n})`);
  console.log(`DIFFERENT: ${differ.size} field(s)`);
  process.exit(1);
}
console.log("IDENTICAL");
