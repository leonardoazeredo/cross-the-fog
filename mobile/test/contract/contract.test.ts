import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { buildWebHtml } from "../../scripts/build-web.js";
import { runContractCheck } from "../../scripts/web/contract.js";
import { STANDARD_TILE_COUNT, standardBackup } from "../fixtures/make-backup.js";

const APP_DIR = resolve(import.meta.dirname, "../../../app");

const fixture = { zip: standardBackup(), name: "standard.zip", tiles: STANDARD_TILE_COUNT };
const build = (editIndex?: (html: string) => string) =>
  buildWebHtml({ appDir: APP_DIR, devTools: false, ...(editIndex ? { editIndex } : {}) });

it("RF4: the generated page loads the standard backup", async () =>
  expect((await runContractCheck(await build(), fixture)).failures).toEqual([]));

it("names a missing element", async () => {
  const { failures } = await runContractCheck(
    await build((h) => h.replace('id="zip"', 'id="zap"')),
    fixture,
  );
  expect(failures).toContain("missing element #zip");
});

it("names the engine globals when the engine script tag is gone", async () => {
  const { failures } = await runContractCheck(
    await build((h) => h.replace('<script src="src/engine.ts"></script>', "")),
    fixture,
  );
  expect(failures).toContain("missing global FogZip.unzip");
  expect(failures).toContain("missing global FogParser.FogMap.prototype.addTile");
  expect(failures).toContain("missing global Sha256.hex");
  expect(failures).toContain("missing global FogGain.create");
});

// The built page's inline script is under a CSP hash, so main.js is edited in a copy of app/ and built from there:
// an edit of the built HTML would stop every script and make the whole of CrossfogPage vanish.
it("names each CrossfogPage field the page stopped setting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crossfog-app-"));
  try {
    cpSync(APP_DIR, dir, { recursive: true });
    const mainPath = join(dir, "src/main.js");
    const main = readFileSync(mainPath, "utf-8");
    const tail = /fogMap, fogChanged, reveal: window\.Reveal, history, lastImport: importStats,/;
    const status = /,\s*exportStatus: fowExport\.onStatus/;
    expect(
      tail.test(main) && status.test(main),
      "main.js still sets CrossfogPage as this case expects",
    ).toBe(true);
    writeFileSync(
      mainPath,
      main.replace(tail, "fogMap, reveal: window.Reveal, history,").replace(status, ""),
    );
    const html = await buildWebHtml({ appDir: dir, devTools: false });
    const { failures } = await runContractCheck(html, fixture);
    expect(failures).toEqual([
      "CrossfogPage.fogChanged is not a function",
      "CrossfogPage.exportStatus is not a function",
      "CrossfogPage.lastImport is not an object",
      "CrossfogPage.lastImport.corrupt is not a number",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("fails when the fixture's tile count doesn't match", async () => {
  const { failures } = await runContractCheck(await build(), { ...fixture, tiles: 3 });
  expect(failures.some((f) => f.startsWith("fixture load reported"))).toBe(true);
});
