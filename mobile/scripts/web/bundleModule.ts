import { resolve } from "node:path";
import * as esbuild from "esbuild";

/**
 * One TypeScript file of the page, bundled as a classic script whose top-level `var` is its exports object, so
 * the page's other scripts reach it as `window.<globalName>` exactly as they reached the IIFE it replaced.
 */
export function bundleModule(file: string, globalName: string): string {
  const result = esbuild.buildSync({
    entryPoints: [resolve(file)],
    bundle: true,
    format: "iife",
    globalName,
    target: ["safari16.4", "chrome120"],
    write: false,
  });
  const out = result.outputFiles[0];
  if (out == null) throw new Error(`esbuild produced no output for ${file}`);
  return out.text;
}
