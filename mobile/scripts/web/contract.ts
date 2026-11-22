import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { encodeBase64 } from "../../src/bridge/base64.js";
import type { NativeToWeb } from "../../src/bridge/protocol.js";
import { encode, ORIGIN } from "../../src/bridge/protocol.js";
import { parseWebToNative } from "../../test/support/parseWebToNative.js";
import type { CrossfogPageApi } from "../../web-adapter/crossfogPage.js";

const ELEMENTS = ["zip", "folder", "loadStatus", "sidebar", "brandName", "hint"];
// Sha256.hex is read only on Send, so a page that lost it would load without an error: the list names it.
const GLOBALS = [
  "FogZip.unzip",
  "FogParser.FogMap.prototype.addTile",
  "Sha256.hex",
  "FogGain.create",
];
type FieldKind = "function" | "object" | "number";
type Fn = (...args: never[]) => unknown;
// Every path of the interface that ends in a function or a plain value, which is what the adapter reads.
type LeafPaths<T, P extends string = ""> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends Fn
    ? `${P}${K}`
    : NonNullable<T[K]> extends object
      ? LeafPaths<NonNullable<T[K]>, `${P}${K}.`>
      : `${P}${K}`;
}[keyof T & string];
// Those paths and the objects on the way to them (not the members of a function), which the list may name too.
type AllPaths<T, P extends string = ""> = {
  [K in keyof T & string]-?:
    | `${P}${K}`
    | (NonNullable<T[K]> extends Fn
        ? never
        : NonNullable<T[K]> extends object
          ? AllPaths<NonNullable<T[K]>, `${P}${K}.`>
          : never);
}[keyof T & string];

// What the adapter reads off window.CrossfogPage, a path for every leaf of CrossfogPageApi (web-adapter/crossfogPage.d.ts):
// a field added there without a path here does not compile, and a path the interface lacks is rejected too. Objects
// on the way may be listed as well, to name the one that is missing. A field main.js stops setting shows up only as a
// feature that does nothing: the history never reaches the panel, the Send chip never changes, a damaged import goes
// unreported.
const CROSSFOG_PAGE_FIELDS: Record<LeafPaths<CrossfogPageApi>, FieldKind> &
  Partial<Record<AllPaths<CrossfogPageApi>, FieldKind>> = {
  "fogMap.addCells": "function",
  "fogMap.clearOverlay": "function",
  fogChanged: "function",
  "reveal.reveal": "function",
  "reveal.RULES": "object",
  "reveal.RULES.version": "number",
  "reveal.RULES.maxAccuracyM": "number",
  "reveal.RULES.maxGapS": "number",
  "reveal.RULES.maxGapM": "number",
  "reveal.RULES.halfWidthM": "number",
  "history.setActivities": "function",
  "history.setTrack": "function",
  "history.trackUnavailable": "function",
  "history.setUnreadable": "function",
  "history.setStuck": "function",
  "history.setState": "function",
  routeStatus: "function",
  linkStatus: "function",
  exportStatus: "function",
  lastImport: "object",
  "lastImport.corrupt": "number",
};
const CHUNK_SIZE = 64 * 1024;

export async function runContractCheck(
  html: string,
  fixture: { zip: Uint8Array; name: string; tiles: number },
): Promise<{ failures: string[] }> {
  const failures: string[] = [];
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__contractSent = [] as string[];
      (window as unknown as Record<string, unknown>).__cspBlocked = false;
      (window as unknown as Record<string, unknown>).ReactNativeWebView = {
        postMessage(data: string) {
          ((window as unknown as Record<string, unknown>).__contractSent as string[]).push(data);
        },
      };
      document.addEventListener("securitypolicyviolation", (ev) => {
        const e = ev as unknown as { blockedURI: string };
        if (e.blockedURI.includes("example.com")) {
          (window as unknown as Record<string, unknown>).__cspBlocked = true;
        }
      });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const originBase = new URL(ORIGIN).origin;
    const extraUrls: string[] = [];
    await page.route("**", async (route) => {
      const url = route.request().url();
      if (url === ORIGIN) {
        await route.fulfill({ body: html, contentType: "text/html" });
      } else {
        if (url.startsWith(originBase)) extraUrls.push(url);
        await route.abort();
      }
    });

    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });

    for (const id of ELEMENTS) {
      if (!(await page.$(`#${id}`))) failures.push(`missing element #${id}`);
    }

    for (const path of GLOBALS) {
      const exists = await page.evaluate((p: string) => {
        const parts = p.split(".");
        let obj: unknown = window;
        for (const part of parts) {
          if (obj == null) return false;
          obj = (obj as Record<string, unknown>)[part];
        }
        return obj !== undefined;
      }, path);
      if (!exists) failures.push(`missing global ${path}`);
    }

    const pageProblems = await page.evaluate((fields: Array<[string, string]>) => {
      const problems: string[] = [];
      for (const [path, kind] of fields) {
        let value: unknown = (window as unknown as Record<string, unknown>).CrossfogPage;
        for (const part of path.split(".")) {
          value = value == null ? undefined : (value as Record<string, unknown>)[part];
        }
        if (typeof value !== kind || value === null)
          problems.push(
            `CrossfogPage.${path} is not ${kind === "object" ? "an object" : `a ${kind}`}`,
          );
      }
      return problems;
    }, Object.entries(CROSSFOG_PAGE_FIELDS));
    failures.push(...pageProblems);

    const waitForType = async (type: string, ms: number) => {
      try {
        await page.waitForFunction(
          (t: string) =>
            ((window as unknown as Record<string, unknown>).__contractSent as string[]).some(
              (m) => {
                try {
                  return (JSON.parse(m) as Record<string, unknown>)?.type === t;
                } catch {
                  return false;
                }
              },
            ),
          type,
          { timeout: ms },
        );
        const raw = await page.evaluate(
          (t: string) =>
            ((window as unknown as Record<string, unknown>).__contractSent as string[]).find(
              (m) => {
                try {
                  return (JSON.parse(m) as Record<string, unknown>)?.type === t;
                } catch {
                  return false;
                }
              },
            ) ?? null,
          type,
        );
        return raw ? parseWebToNative(raw) : null;
      } catch {
        return null;
      }
    };

    const dispatch = (msg: NativeToWeb) =>
      page.evaluate((data: string) => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      }, encode(msg));

    const ready = await waitForType("ready", 10_000);
    if (!ready) {
      failures.push("adapter never sent ready");
    } else {
      const fingerprint = createHash("sha256").update(fixture.zip).digest("hex");
      const total = Math.max(1, Math.ceil(fixture.zip.length / CHUNK_SIZE));

      await dispatch({
        v: 1,
        type: "reload",
        fingerprint,
        name: fixture.name,
        savedAt: new Date().toISOString(),
        size: fixture.zip.length,
        role: "current",
      });

      await waitForType("needBytes", 10_000);

      for (let i = 0; i < total; i++) {
        const slice = fixture.zip.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await dispatch({
          v: 1,
          type: "chunk",
          fingerprint,
          index: i,
          total,
          data: encodeBase64(slice),
        });
      }

      const loadedMsg = await waitForType("loaded", 30_000);
      if (loadedMsg?.type !== "loaded") {
        failures.push(`fixture load reported ${JSON.stringify(loadedMsg ?? "nothing")}`);
      } else if (!loadedMsg.ok || loadedMsg.tiles !== fixture.tiles) {
        failures.push(`fixture load reported ${JSON.stringify(loadedMsg)}`);
      }
    }

    await page.evaluate(() => {
      fetch("https://example.com/").catch(() => {});
    });
    await page.waitForTimeout(500);
    const cspBlocked = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__cspBlocked as boolean,
    );
    if (!cspBlocked) failures.push("CSP did not block connect-src");

    for (const url of extraUrls) failures.push(`page requested ${url}`);
    for (const msg of pageErrors) failures.push(`page error: ${msg}`);
  } finally {
    await browser.close();
  }

  return { failures };
}
