import { resolve } from "node:path";
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

it("names a missing global", async () => {
  const { failures } = await runContractCheck(
    await build((h) => h.replace('<script src="src/unzip.js"></script>', "")),
    fixture,
  );
  expect(failures).toContain("missing global FogZip.unzip");
});

it("names a missing module global when its script tag is gone", async () => {
  const { failures } = await runContractCheck(
    await build((h) => h.replace('<script src="src/sha256.ts" data-global="Sha256"></script>', "")),
    fixture,
  );
  expect(failures).toContain("missing global Sha256.hex");
});

it("fails when the fixture's tile count doesn't match", async () => {
  const { failures } = await runContractCheck(await build(), { ...fixture, tiles: 3 });
  expect(failures.some((f) => f.startsWith("fixture load reported"))).toBe(true);
});
