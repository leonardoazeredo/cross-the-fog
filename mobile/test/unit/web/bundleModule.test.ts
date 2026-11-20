import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
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
});

it("fails the build when a package from a node_modules above the folder is imported", () => {
  const dir = tree({
    "src/entry.ts": 'import { x } from "somepkg";\n(globalThis as any).out = x;\n',
    "node_modules/somepkg/index.js": "export const x = 1;\n",
    "node_modules/somepkg/package.json": '{"name":"somepkg","version":"1.0.0","main":"index.js"}',
  });
  expect(() => bundleModule(join(dir, "src/entry.ts"), join(dir, "src"))).toThrow(BuildError);
});

it("gives the page's engine script its window globals, and takes nothing from outside app/src", () => {
  const context = vm.createContext({ TextEncoder });
  // The page's window is the context's own global, so a binding that is not a property of it would not reach the page.
  context.window = context;
  vm.runInContext(bundleModule(join(APP_SRC, "engine.ts"), APP_SRC), context);
  expect(vm.runInContext("window.Sha256.hex('abc')", context)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(vm.runInContext("typeof window.FogGain.create", context)).toBe("function");
  expect(vm.runInContext("window.FogGain.DEFOG_HALF_M", context)).toBe(15);
});
