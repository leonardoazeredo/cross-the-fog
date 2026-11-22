import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildCsp } from "../../../scripts/web/csp.js";
import { standInOrigin } from "../../../scripts/web/standIn.js";
import { standInScript } from "../../../src/bridge/pageConfig.js";

const require = createRequire(import.meta.url);
const { applyStandIn } = require("../../../plugins/withE2eStandIn.cjs");

describe("standInOrigin", () => {
  it("is nothing without CROSSFOG_E2E_STANDIN", () => {
    expect(standInOrigin({})).toBeUndefined();
    expect(standInOrigin({ CROSSFOG_E2E: "1" })).toBeUndefined();
  });
  it("refuses a stand-in outside an e2e build", () => {
    expect(() => standInOrigin({ CROSSFOG_E2E_STANDIN: "http://10.0.2.2:8787" })).toThrow(
      /CROSSFOG_E2E=1/,
    );
  });
  it("accepts only the emulator host or loopback over http with a port", () => {
    const e2e = (o: string) => standInOrigin({ CROSSFOG_E2E: "1", CROSSFOG_E2E_STANDIN: o });
    expect(e2e("http://10.0.2.2:8787")).toBe("http://10.0.2.2:8787");
    expect(e2e("http://localhost:9000")).toBe("http://localhost:9000");
    for (const bad of [
      "https://10.0.2.2:8787",
      "http://example.com:8787",
      "http://10.0.2.2",
      "http://10.0.2.2:8787/x",
    ])
      expect(() => e2e(bad)).toThrow(/must be http/);
  });
});

describe("the content security policy", () => {
  it("names the stand-in only when given one", () => {
    expect(buildCsp(["'sha256-a'"])).not.toContain("10.0.2.2");
    expect(buildCsp(["'sha256-a'"], ["http://10.0.2.2:8787"])).toContain("http://10.0.2.2:8787");
  });
});

describe("the manifest plugin", () => {
  it("allows cleartext on the application", () => {
    const m = { manifest: { application: [{ $: { "android:name": ".A" } }] } };
    expect(applyStandIn(m).manifest.application[0].$).toEqual({
      "android:name": ".A",
      "android:usesCleartextTraffic": "true",
    });
  });
  it("does nothing without the variable and refuses it outside an e2e build", () => {
    const plugin = require("../../../plugins/withE2eStandIn.cjs");
    const cfg = { name: "x" };
    const saved = { ...process.env };
    try {
      delete process.env.CROSSFOG_E2E_STANDIN;
      expect(plugin(cfg)).toBe(cfg);
      process.env.CROSSFOG_E2E_STANDIN = "http://10.0.2.2:8787";
      delete process.env.CROSSFOG_E2E;
      expect(() => plugin(cfg)).toThrow(/CROSSFOG_E2E=1/);
    } finally {
      process.env = saved;
    }
  });
});

describe("standInScript", () => {
  it("is nothing without an origin", () => {
    expect(standInScript(null)).toBeUndefined();
    expect(standInScript("")).toBeUndefined();
  });

  function run() {
    const calls: Array<[unknown, unknown]> = [];
    const win = { fetch: (u: unknown, o: unknown) => (calls.push([u, o]), Promise.resolve("ok")) };
    new Function("window", standInScript("http://10.0.2.2:8787") as string)(win);
    return { win, calls };
  }

  it("sends Overpass requests, keyed or not, and elevation tiles to the stand-in with the options unchanged", async () => {
    const { win, calls } = run();
    const opts = { method: "POST" };
    await win.fetch("https://overpass-api.de/api/interpreter", opts);
    await win.fetch("https://overpass.nextgis.com/KEY/api/interpreter", opts);
    await win.fetch(
      "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/1/2.png",
      undefined,
    );
    expect(calls.map((c) => c[0])).toEqual([
      "http://10.0.2.2:8787/overpass/api/interpreter",
      "http://10.0.2.2:8787/overpass/KEY/api/interpreter",
      "http://10.0.2.2:8787/elevation/terrarium/12/1/2.png",
    ]);
    expect(calls[0]?.[1]).toBe(opts);
  });

  it("leaves every other request alone", async () => {
    const { win, calls } = run();
    await win.fetch("https://tile.openstreetmap.org/1/2/3.png", undefined);
    await win.fetch("https://overpass-api.de.evil.example/x", undefined);
    expect(calls.map((c) => c[0])).toEqual([
      "https://tile.openstreetmap.org/1/2/3.png",
      "https://overpass-api.de.evil.example/x",
    ]);
  });
});
