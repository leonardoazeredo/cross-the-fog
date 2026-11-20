import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";
import { bundleModule } from "../../../scripts/web/bundleModule.js";

const APP_SRC = join(import.meta.dirname, "../../../../app/src");

it("bundles a module as a classic script whose top-level var is its exports object", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-module-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, "export function twice(n: number): number { return n * 2; }\n");
  const context = vm.createContext({});
  vm.runInContext(bundleModule(file, "Twice"), context);
  expect(vm.runInContext("Twice.twice(4)", context)).toBe(8);
});

it("gives the page's sha256 module the same window.Sha256.hex the IIFE had", () => {
  const context = vm.createContext({ TextEncoder });
  // The context's own global is the page's window, so a `const` or `let` binding would not reach it.
  context.window = context;
  vm.runInContext(bundleModule(join(APP_SRC, "sha256.ts"), "Sha256"), context);
  expect(vm.runInContext("window.Sha256.hex('abc')", context)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(vm.runInContext("typeof window.Sha256.hex", context)).toBe("function");
});
