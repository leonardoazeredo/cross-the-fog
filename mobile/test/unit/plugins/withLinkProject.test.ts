import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyLinkProject, MARKER } = require("../../../plugins/withLinkProject.cjs");

const SETTINGS = "include ':app'\n";

it("includes the shared link/ project from the repository root", () => {
  const out = applyLinkProject(SETTINGS);
  expect(out.startsWith(SETTINGS)).toBe(true);
  expect(out).toContain("include ':link'");
  expect(out).toContain("project(':link').projectDir = new File(rootDir, '../../link')");
});

it("is idempotent, since prebuild runs again on an existing android folder", () => {
  const once = applyLinkProject(SETTINGS);
  expect(applyLinkProject(once)).toBe(once);
  expect(once.split(MARKER).length).toBe(2);
});
