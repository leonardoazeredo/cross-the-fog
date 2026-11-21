import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyNextgisKeyCheck, MARKER } = require("../../../plugins/withNextgisKeyCheck.cjs");

const GRADLE = 'apply plugin: "com.android.application"\n';

it("checks the release bundle task before it runs, and no other variant's", () => {
  const out = applyNextgisKeyCheck(GRADLE);
  expect(out.startsWith(GRADLE)).toBe(true);
  expect(out).toContain("createBundle.*ReleaseJsAndAssets");
  expect(out).toContain("doFirst");
  expect(out).not.toMatch(/createBundle\.\*JsAndAssets/);
});

it("reads NEXTGIS_OVERPASS_KEY and CROSSFOG_E2E, so an e2e build is let through", () => {
  const out = applyNextgisKeyCheck(GRADLE);
  expect(out).toContain('providers.environmentVariable("NEXTGIS_OVERPASS_KEY")');
  expect(out).toContain('providers.environmentVariable("CROSSFOG_E2E")');
});

it("fails with a line that names the variable and never prints a value", () => {
  const out = applyNextgisKeyCheck(GRADLE);
  expect(out).toContain("GradleException");
  expect(out).toContain("NEXTGIS_OVERPASS_KEY is not set");
  // The exception line interpolates nothing named like the key.
  const throwLine = out.split("\n").find((l: string) => l.includes("GradleException")) ?? "";
  expect(throwLine).not.toMatch(/\$\{?\w*[kK]ey/);
});

it("is idempotent, since prebuild runs again on an existing android folder", () => {
  const once = applyNextgisKeyCheck(GRADLE);
  expect(applyNextgisKeyCheck(once)).toBe(once);
  expect(once.split(MARKER).length).toBe(2);
});
