import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  applyReleaseBundleInputs,
  MARKER,
} = require("../../../plugins/withReleaseBundleInputs.cjs");

const GRADLE = 'apply plugin: "com.android.application"\n';

it("adds the generate task and makes the bundle tasks depend on it and its output", () => {
  const out = applyReleaseBundleInputs(GRADLE);
  expect(out.startsWith(GRADLE)).toBe(true);
  expect(out).toContain('tasks.register("generateCrossfogPage", Exec)');
  expect(out).toContain('commandLine "pnpm", "generate"');
  expect(out).toContain('dependsOn("generateCrossfogPage")');
  expect(out).toContain("inputs.file(crossfogPage)");
});

it("declares every source the page is built from", () => {
  const out = applyReleaseBundleInputs(GRADLE);
  expect(out).toContain('inputs.dir("$crossfogRepo/app")');
  expect(out).toContain('["web-adapter", "scripts", "licenses"]');
  expect(out).toContain('providers.environmentVariable("CROSSFOG_E2E")');
});

it("is idempotent, since prebuild runs again on an existing android folder", () => {
  const once = applyReleaseBundleInputs(GRADLE);
  expect(applyReleaseBundleInputs(once)).toBe(once);
  expect(once.split(MARKER).length).toBe(2);
});
