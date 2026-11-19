import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINK_MARKER, prebuildNeeded, shouldPrebuild } from "../../scripts/androidEnv.js";

const WITH_LINK = `include ':app'\n${LINK_MARKER}\ninclude ':link'\n`;

describe("shouldPrebuild", () => {
  it("prebuilds when android/ has no gradlew, even if a settings.gradle with the include is left behind", () => {
    expect(shouldPrebuild(false, null)).toBe(true);
    expect(shouldPrebuild(false, WITH_LINK)).toBe(true);
  });

  it("prebuilds an android/ that predates the link include", () => {
    expect(shouldPrebuild(true, "include ':app'\n")).toBe(true);
    expect(shouldPrebuild(true, null)).toBe(true);
  });

  it("leaves an android/ that has the include alone, so one prebuilt on purpose keeps its settings", () => {
    expect(shouldPrebuild(true, WITH_LINK)).toBe(false);
  });
});

describe("prebuildNeeded reads the android/ directory", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "android-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("needs a prebuild when the directory does not exist", () => {
    expect(prebuildNeeded(join(dir, "missing"))).toBe(true);
  });

  it("needs one when there is a gradlew but no settings.gradle", () => {
    writeFileSync(join(dir, "gradlew"), "");
    expect(prebuildNeeded(dir)).toBe(true);
  });

  it("needs one when settings.gradle has the include but there is no gradlew", () => {
    writeFileSync(join(dir, "settings.gradle"), WITH_LINK);
    expect(prebuildNeeded(dir)).toBe(true);
  });

  it("needs one when settings.gradle predates the include", () => {
    writeFileSync(join(dir, "gradlew"), "");
    writeFileSync(join(dir, "settings.gradle"), "include ':app'\n");
    expect(prebuildNeeded(dir)).toBe(true);
  });

  it("is skipped for a gradlew and a settings.gradle that has the include", () => {
    writeFileSync(join(dir, "gradlew"), "");
    writeFileSync(join(dir, "settings.gradle"), WITH_LINK);
    expect(prebuildNeeded(dir)).toBe(false);
  });

  it("does not read settings.gradle.kts in place of settings.gradle", () => {
    writeFileSync(join(dir, "gradlew"), "");
    writeFileSync(join(dir, "settings.gradle.kts"), WITH_LINK);
    expect(prebuildNeeded(dir)).toBe(true);
  });

  it("does not take a gradlew in a subdirectory for the project's own", () => {
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "gradlew"), "");
    writeFileSync(join(dir, "settings.gradle"), WITH_LINK);
    expect(prebuildNeeded(dir)).toBe(true);
  });
});

// The script runs at import and exits the process, so it cannot be driven from a test; these two pin
// that it asks the function above about its android/ and prebuilds without installing.
describe("scripts/android-test.ts", () => {
  // Comment lines are dropped so a commented-out call cannot satisfy a pattern.
  const script = readFileSync(
    resolve(fileURLToPath(import.meta.url), "../../../scripts/android-test.ts"),
    "utf8",
  )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  it("asks prebuildNeeded about the android/ folder under its own mobile/ directory", () => {
    expect(script).toContain('const mobile = join(import.meta.dirname, "..");');
    expect(script).toContain('const androidDir = join(mobile, "android");');
  });

  it("prebuilds android without installing, and only inside the prebuildNeeded branch", () => {
    expect(script).toMatch(
      /if \(prebuildNeeded\(androidDir\)\) \{[^}]*?"prebuild",\s*"--platform",\s*"android",\s*"--no-install"/,
    );
  });
});
