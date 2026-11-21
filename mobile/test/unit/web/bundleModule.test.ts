import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { inflateSync, unzlibSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { bundleModule } from "../../../scripts/web/bundleModule.js";
import { BuildError } from "../../../scripts/web/transform.js";

const APP_SRC = join(import.meta.dirname, "../../../../app/src");

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bundle-module-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

it("bundles an entry and what it imports into one script that runs on its own", () => {
  const dir = tree({
    "src/entry.ts": 'import { twice } from "./math.ts";\n(globalThis as any).out = twice(4);\n',
    "src/math.ts": "export const twice = (n: number): number => n * 2;\n",
  });
  const context = vm.createContext({});
  vm.runInContext(bundleModule(join(dir, "src/entry.ts"), join(dir, "src")), context);
  expect(context.out).toBe(8);
});

it("fails the build when the bundle takes an input from outside the scanned folder", () => {
  const dir = tree({
    "src/entry.ts": 'import { x } from "../outside.ts";\n(globalThis as any).out = x;\n',
    "outside.ts": "export const x = 1;\n",
  });
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow(BuildError);
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow("outside.ts");
});

it("fails the build when a symlink inside the folder leads outside it", () => {
  const dir = tree({
    "src/entry.ts": 'import { x } from "./link.ts";\n(globalThis as any).out = x;\n',
    "elsewhere/y.ts": "export const x = 1;\n",
  });
  symlinkSync(join(dir, "elsewhere/y.ts"), join(dir, "src/link.ts"));
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow(BuildError);
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow("y.ts");
});

it("fails the build when a package from a node_modules above the folder is imported", () => {
  const dir = tree({
    "src/entry.ts": 'import { x } from "somepkg";\n(globalThis as any).out = x;\n',
    "node_modules/somepkg/index.js": "export const x = 1;\n",
    "node_modules/somepkg/package.json": '{"name":"somepkg","version":"1.0.0","main":"index.js"}',
  });
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow(BuildError);
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow("somepkg");
});

it("gives the page's engine script its window globals, and takes nothing from outside app/src", () => {
  const context = vm.createContext({ TextEncoder, TextDecoder });
  // The page's window is the context's own global, so a binding that is not a property of it would not reach the page.
  context.window = context;
  vm.runInContext(bundleModule(join(APP_SRC, "engine.ts"), APP_SRC), context);
  expect(vm.runInContext("window.Sha256.hex('abc')", context)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(vm.runInContext("typeof window.FogGain.create", context)).toBe("function");
  expect(vm.runInContext("window.FogGain.DEFOG_HALF_M", context)).toBe(15);
  // the converted modules run in a context with no page global but window and the two text codecs: nothing they call is one
  expect(vm.runInContext("Object.keys(window.FogParser).join()", context)).toBe(
    "FogMap,parseTileId,tileToLngLat,cellToLngLat,lngLatToCell,WORLD_CELLS,MAP_WIDTH,BITS_PER_TILE_EDGE,FORMAT",
  );
  expect(vm.runInContext("window.MD5.hex('117660')", context)).toBe(
    createHash("md5").update("117660").digest("hex"),
  );
  expect(
    vm.runInContext(
      "const m = new window.FogParser.FogMap(); m.addCells(new Int32Array([5, 6, 5, 7, 5, 6])) + ',' + m.totalVisited() + ',' + m.isVisitedCell(5, 7) + ',' + m.hasFog()",
      context,
    ),
  ).toBe("2,2,true,true");
  expect(vm.runInContext("Object.keys(window.FogWriter).join()", context)).toBe(
    "tileName,writeTile,writeSync",
  );
  expect(vm.runInContext("Object.keys(window.FogZip).join()", context)).toBe("unzip");
  expect(vm.runInContext("Object.keys(window.Reveal).join()", context)).toBe("RULES,reveal");
  expect(vm.runInContext("Object.keys(window.Estimates).join()", context)).toBe(
    "estimate,climb,routeStats,distanceM",
  );
  expect(vm.runInContext("Object.keys(window.StreetMessages).join()", context)).toBe(
    "describe,progress",
  );
  expect(vm.runInContext("Object.keys(window.ImportMessages).join()", context)).toBe(
    "status,tally,decode,isTileName",
  );
  expect(vm.runInContext("Object.keys(window.Elevation).join()", context)).toBe(
    "create,open,within,tileOf,decodeHeight",
  );
  expect(
    vm.runInContext("window.Estimates.estimate([[0, 0], [0, 0.001]]).distanceM", context),
  ).toBe(111);
  expect(vm.runInContext("window.StreetMessages.progress({ done: 1, total: 4 })", context)).toBe(
    "Getting the street map, 1 of 4…",
  );
  // no pako on the page: the deflate default says so with its own message (the inflate default's is checked after it, so it is not reached here)
  expect(() =>
    vm.runInContext("window.FogWriter.writeSync(new window.FogParser.FogMap())", context),
  ).toThrow(/writeSync needs a deflate function/);
  expect(
    vm.runInContext("window.Reveal.reveal([{ t: 0, lat: 10, lon: 10 }]).length > 0", context),
  ).toBe(true);
  // a stored entry needs no inflater; a deflated one asks for pako, which this page does not have
  const text = new TextEncoder().encode("a".repeat(200));
  const asBuffer = (zip: Uint8Array) =>
    zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  context.storedZip = asBuffer(zipSync({ "a.txt": [text, { level: 0 }] }));
  context.deflatedZip = asBuffer(zipSync({ "a.txt": [text, { level: 6 }] }));
  expect(
    vm.runInContext(
      "(() => { const e = window.FogZip.unzip(storedZip); return e[0].name + ':' + e[0].data.length; })()",
      context,
    ),
  ).toBe("a.txt:200");
  expect(() => vm.runInContext("window.FogZip.unzip(deflatedZip)", context)).toThrow(
    /pako is not defined/,
  );
  expect(
    vm.runInContext(
      "(() => { try { window.FogZip.unzip(deflatedZip); } catch (e) { return e.name; } })()",
      context,
    ),
  ).toBe("ReferenceError");
  // pako that arrives after the engine ran is the one used: the lookup happens when unzip runs
  context.pako = { inflateRaw: inflateSync, inflate: unzlibSync };
  expect(
    vm.runInContext(
      "(() => { const e = window.FogZip.unzip(deflatedZip); return e[0].name + ':' + e[0].data.length; })()",
      context,
    ),
  ).toBe("a.txt:200");
});
