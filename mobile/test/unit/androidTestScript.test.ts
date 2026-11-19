import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LINK_MARKER, shouldPrebuild } from "../../scripts/androidEnv.js";

const SCRIPT = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../../../scripts/android-test.ts"),
  "utf8",
);
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

// The script runs at import and exits the process, so it cannot be driven from a test; these pin the
// lines that wire the decision to what is on disk.
describe("scripts/android-test.ts wiring", () => {
  it("decides on the gradlew it found and the settings.gradle it read", () => {
    expect(SCRIPT).toContain('const hasGradlew = existsSync(join(androidDir, "gradlew"));');
    expect(SCRIPT).toContain('const settingsFile = join(androidDir, "settings.gradle");');
    expect(SCRIPT).toContain("if (shouldPrebuild(hasGradlew, settings)) {");
  });

  it("prebuilds android only, without installing", () => {
    expect(SCRIPT).toContain(
      '["exec", "expo", "prebuild", "--platform", "android", "--no-install"]',
    );
  });

  it("generates the page first when there is no gradlew", () => {
    expect(SCRIPT).toMatch(
      /if \(!hasGradlew\) \{\n\s+say\([^\n]+\n\s+if \(run\("pnpm", \["generate"\]/,
    );
  });
});
