import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import appConfig from "../../../app.config.js";

const require = createRequire(import.meta.url);
const MOBILE = resolve(fileURLToPath(import.meta.url), "../../../..");
const PLUGIN = "./plugins/withMinSdk.cjs";
const { applyMinSdk, MIN_SDK, MARKER } = require("../../../plugins/withMinSdk.cjs") as {
  applyMinSdk: (contents: string) => string;
  MIN_SDK: number;
  MARKER: string;
};

const ROOT = `buildscript {\n}\n\nallprojects {\n}\n\napply plugin: "expo-root-project"\napply plugin: "com.facebook.react.rootproject"\n`;

describe("the phone's minSdk", () => {
  it("is 29, where the platform has TLS 1.3 for the link", () => {
    expect(MIN_SDK).toBe(29);
  });

  it("is set in the root build file before expo-root-project, which only fills a value that is not there", () => {
    const out = applyMinSdk(ROOT);
    const set = out.indexOf(`minSdkVersion = ${MIN_SDK}`);
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(out.indexOf('apply plugin: "expo-root-project"'));
    expect(out).toContain(MARKER);
  });

  it("is set once, however many times a prebuild runs over the same file", () => {
    const once = applyMinSdk(ROOT);
    expect(applyMinSdk(once)).toBe(once);
    expect(once.match(/minSdkVersion = /g)).toHaveLength(1);
  });

  it("fails loudly when the template has no expo-root-project line to anchor on", () => {
    expect(() => applyMinSdk("buildscript {\n}\n")).toThrow(/expo-root-project/);
  });
});

describe("the plugin", () => {
  const plugins = (appConfig({ config: {} } as never).plugins ?? []).map((p) =>
    Array.isArray(p) ? p[0] : p,
  );

  it("is registered once in app.config.ts, and its file exists", () => {
    expect(plugins.filter((p) => p === PLUGIN)).toHaveLength(1);
    expect(existsSync(resolve(MOBILE, PLUGIN))).toBe(true);
  });
});

describe("the watch's minSdk", () => {
  const gradle = readFileSync(resolve(MOBILE, "../watch/app/build.gradle.kts"), "utf8");

  it("is the same 29, and is the only minSdk in the file", () => {
    expect([...gradle.matchAll(/minSdk\s*=\s*(\d+)/g)].map((m) => Number(m[1]))).toEqual([29]);
  });
});
