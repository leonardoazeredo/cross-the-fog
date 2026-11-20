import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { benchTests } from "./benchTests.js";

const repo = resolve(import.meta.dirname, "../..");
// a folder given as the first argument stands in for bench/ (the script's own test does that)
const benchDir = process.argv[2] ?? join(repo, "bench");
const tests = benchTests(benchDir);
if (tests.length === 0) {
  console.error(`bench-test: no *.test.js in ${benchDir}`);
  process.exit(1);
}

function say(text: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} bench-test: ${text}`);
}

say(
  `running ${tests.length} tests one after the other, about 20 s in all; a failing test stops the run`,
);
const started = Date.now();
for (const [i, file] of tests.entries()) {
  const run = spawnSync(process.execPath, [file], { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) {
    say(`${basename(file)} failed (${i + 1} of ${tests.length}), its output follows`);
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    process.exit(1);
  }
}
say(`${tests.length} tests passed in ${Math.round((Date.now() - started) / 1000)} s`);
