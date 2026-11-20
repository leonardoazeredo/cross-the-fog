import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(fileURLToPath(import.meta.url), "../../../../..");
const LEFTHOOK_YML = readFileSync(join(REPO, "lefthook.yml"), "utf8");

const hasLefthook = spawnSync("lefthook", ["version"]).status === 0;

// Asks lefthook itself whether the pre-push `verify` command would run for a push of one file. The command
// line is swapped for an echo: the question is only whether lefthook skips it.
function runsFor(file: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "prepush-"));
  try {
    const config = join(dir, "lefthook.yml");
    const swapped = LEFTHOOK_YML.replace(
      /^(\s*)run: pnpm --dir mobile verify\s*$/m,
      "$1run: echo RAN-VERIFY",
    );
    expect(swapped).not.toBe(LEFTHOOK_YML);
    writeFileSync(config, swapped);
    const out = spawnSync(
      "lefthook",
      ["run", "pre-push", "--no-auto-install", "--command", "verify", "--file", file],
      { cwd: REPO, env: { ...process.env, LEFTHOOK_CONFIG: config }, encoding: "utf8" },
    );
    return `${out.stdout}${out.stderr}`.includes("RAN-VERIFY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the pre-push hook's verify command", () => {
  // The bench tests load the modules the page ships and run them in Node, so verify runs them and a push that
  // changes only bench/ is not skipped (the file list below).
  it("runs the bench tests", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "mobile/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:bench"]).toBe("tsx scripts/bench-test.ts");
    expect(pkg.scripts.verify?.split(" && ")).toContain("pnpm test:bench");
  });

  it("is declared once, as `pnpm --dir mobile verify`", () => {
    expect(LEFTHOOK_YML.match(/^\s*run: pnpm --dir mobile verify\s*$/gm)).toHaveLength(1);
  });

  // lefthook narrows the push's files to those under `root`, so a root of mobile/ alone skips a push that only
  // touches the watch, the link or the page.
  it
    .skipIf(!hasLefthook)
    .each([
      "watch/app/src/main/java/A.kt",
      "watch/app/detekt-baseline.xml",
      "watch/build.gradle.kts",
      "link/src/main/kotlin/B.kt",
      "link/build.gradle.kts",
      "app/src/main.js",
      "app/index.html",
      "bench/engine-host.test.js",
      "bench/lib/load.js",
      "mobile/package.json",
      "mobile/src/link/send.ts",
    ])("runs for a push touching %s", (file) => {
    expect(runsFor(file)).toBe(true);
  });

  // A push touching only paths outside those folders has nothing for verify to check and would cost a minute.
  it.skipIf(!hasLefthook).each(["docs/x.md", "README.md", "lefthook.yml"])(
    "is skipped for a push touching only %s",
    (file) => {
      expect(runsFor(file)).toBe(false);
    },
  );
});
