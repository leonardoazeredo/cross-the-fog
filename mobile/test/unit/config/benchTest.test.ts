import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { benchTests } from "../../../scripts/benchTests.js";

const REPO = resolve(fileURLToPath(import.meta.url), "../../../../..");
const SCRIPT = join(REPO, "mobile/scripts/bench-test.ts");

function runScript(dir: string) {
  return spawnSync("pnpm", ["exec", "tsx", SCRIPT, dir], {
    cwd: join(REPO, "mobile"),
    encoding: "utf8",
  });
}

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bench-test-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("the bench test runner", () => {
  it("lists every bench/*.test.js and nothing else, in name order", () => {
    const listed = benchTests(join(REPO, "bench")).map((p) => p.slice(p.lastIndexOf("/") + 1));
    const onDisk = readdirSync(join(REPO, "bench"))
      .filter((n) => n.endsWith(".test.js"))
      .sort();
    expect(listed).toEqual(onDisk);
    expect(listed.length).toBeGreaterThan(30);
    expect(listed).not.toContain("run.js");
    expect(listed).not.toContain("compare.js");
  });

  it("passes when every test exits 0", () => {
    const dir = folder({ "a.test.js": "", "b.test.js": "console.log('fine')" });
    try {
      const out = runScript(dir);
      expect(out.status).toBe(0);
      expect(out.stdout).toContain("2 tests passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops at the first failing test, names it and shows its output", () => {
    const marker = join(tmpdir(), `bench-test-ran-${process.pid}`);
    const dir = folder({
      "a.test.js": "",
      "b.test.js": "console.error('the reason'); process.exit(3)",
      "c.test.js": `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
    });
    try {
      const out = runScript(dir);
      expect(out.status).toBe(1);
      expect(out.stdout).toContain("b.test.js failed (2 of 3)");
      expect(out.stderr).toContain("the reason");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(marker, { force: true });
    }
  });

  it("fails when the folder holds no test, so an empty run cannot pass", () => {
    const dir = folder({ "run.js": "" });
    mkdirSync(join(dir, "sub"));
    try {
      const out = runScript(dir);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("no *.test.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
