import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssignFiles, OutcomeHooks } from "../../web-adapter/loader.js";
import { installOutcomeHooks, loadCopy } from "../../web-adapter/loader.js";
import {
  backupWithDamagedTiles,
  makeBackup,
  notABackup,
  STANDARD_EXTRAS,
  STANDARD_TILES,
  standardBackup,
} from "../fixtures/make-backup.js";
import { installFakeUpstream } from "./support/fakeUpstream.js";
import { loadUpstreamDom } from "./support/upstreamDom.js";

let zipInput: HTMLInputElement;
let hooks: OutcomeHooks;

const assignFiles: AssignFiles = (input, file) =>
  Object.defineProperty(input, "files", {
    value: Object.assign([], { 0: file, length: 1 }),
    configurable: true,
  });

const load = (bytes: Uint8Array) => loadCopy(bytes, "fog.zip", { zipInput, hooks, assignFiles });

beforeEach(() => {
  loadUpstreamDom(document);
  installFakeUpstream(window, document);
  zipInput = document.getElementById("zip") as HTMLInputElement;
  hooks = installOutcomeHooks(window);
});

afterEach(() => {
  vi.useRealTimers();
});

it("RF4: reports ok and the tile count for the standard backup", async () =>
  expect(await load(standardBackup())).toEqual({ ok: true, tiles: 2 }));

it("reports noTiles for a zip without tiles", async () =>
  expect(await load(notABackup())).toEqual({ ok: false, reason: "noTiles" }));

it("a good backup carries no corrupt count", async () => {
  const outcome = await load(standardBackup());
  expect(outcome).toEqual({ ok: true, tiles: 2 });
  expect(outcome).not.toHaveProperty("corrupt");
});

it("does not call a plain file named like a tile id damaged", async () => {
  const bytes = makeBackup(STANDARD_TILES, {
    ...STANDARD_EXTRAS,
    "Sync/Snapshot": new TextEncoder().encode("junk"),
  });
  expect(await load(bytes)).toEqual({ ok: true, tiles: 2 });
});

it("counts damaged tile files beside the tiles that decoded", async () =>
  expect(await load(backupWithDamagedTiles(3))).toEqual({ ok: true, tiles: 2, corrupt: 3 }));

it("reports corrupt, not noTiles, when tile files are there and none decodes", async () =>
  expect(await load(backupWithDamagedTiles(2, false))).toEqual({ ok: false, reason: "corrupt" }));

it("still reports noTiles when nothing that looks like a tile is there", async () => {
  await load(backupWithDamagedTiles(2, false)); // leaves a count on the page from the load before
  hooks = installOutcomeHooks(window);
  expect(await load(notABackup())).toEqual({ ok: false, reason: "noTiles" });
});

it("treats a page that publishes no count as no damage", async () => {
  (window as unknown as Record<string, unknown>).CrossfogPage = undefined;
  expect(await load(backupWithDamagedTiles(2, false))).toEqual({ ok: false, reason: "noTiles" });
});

it("reports unzip for bytes that aren't a zip", async () =>
  expect(await load(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: "unzip" }));

it("reports memory when unzip runs out of memory", async () => {
  const winAny = window as unknown as Record<string, unknown>;
  (winAny.FogZip as Record<string, unknown>).unzip = () => {
    throw new RangeError("Array buffer allocation failed");
  };
  const memHooks = installOutcomeHooks(window);
  expect(
    await loadCopy(standardBackup(), "fog.zip", { zipInput, hooks: memHooks, assignFiles }),
  ).toEqual({ ok: false, reason: "memory" });
});

it("reports unknown when unzip isn't called within 30 s", async () => {
  vi.useFakeTimers();
  const clone = zipInput.cloneNode(true) as HTMLInputElement;
  zipInput.replaceWith(clone);
  zipInput = clone;
  const p = load(standardBackup());
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await p).toEqual({ ok: false, reason: "unknown" });
});

it("counts only this load's tiles when defog merges loads", async () => {
  await load(standardBackup());
  expect(await load(standardBackup())).toEqual({ ok: true, tiles: 2 });
});

it("names a missing upstream global", () => {
  delete (window as { FogZip?: unknown }).FogZip;
  expect(() => installOutcomeHooks(window)).toThrow("adapter contract: FogZip.unzip missing");
});

it("names a missing FogParser.FogMap.prototype.addTile", () => {
  (window as unknown as Record<string, unknown>).FogParser = { FogMap: { prototype: {} } };
  expect(() => installOutcomeHooks(window)).toThrow(
    "adapter contract: FogParser.FogMap.prototype.addTile missing",
  );
});
