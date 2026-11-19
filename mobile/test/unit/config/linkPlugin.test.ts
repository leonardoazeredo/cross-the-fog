import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import appConfig from "../../../app.config.js";

const MOBILE = resolve(fileURLToPath(import.meta.url), "../../../..");
const LINK_PLUGIN = "./plugins/withLinkProject.cjs";

const plugins = (appConfig({ config: {} } as never).plugins ?? []).map((p) =>
  Array.isArray(p) ? p[0] : p,
);

it("registers the config plugin that includes link/ in the generated android project", () => {
  expect(plugins).toContain(LINK_PLUGIN);
});

it("registers it once, since prebuild would otherwise apply the include twice", () => {
  expect(plugins.filter((p) => p === LINK_PLUGIN)).toHaveLength(1);
});

it("names a file that exists", () => {
  expect(existsSync(resolve(MOBILE, LINK_PLUGIN))).toBe(true);
});
