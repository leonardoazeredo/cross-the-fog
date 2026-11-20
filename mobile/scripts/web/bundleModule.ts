import { isAbsolute, relative, resolve } from "node:path";
import * as esbuild from "esbuild";
import { BuildError } from "./transform.js";

/**
 * The page's TypeScript entry bundled as one classic script (an IIFE that assigns its window globals itself).
 * The host scan reads only `root` (app/src), so a bundle that takes any input from outside it, a package
 * included, fails the build instead of shipping code the scan never saw.
 */
export function bundleModule(file: string, root: string): string {
  const result = esbuild.buildSync({
    entryPoints: [resolve(file)],
    bundle: true,
    format: "iife",
    target: ["safari16.4", "chrome120"],
    write: false,
    metafile: true,
    absWorkingDir: resolve(root),
  });
  const outside = Object.keys(result.metafile.inputs).filter((input) => {
    const rel = relative(resolve(root), resolve(root, input));
    return rel.startsWith("..") || isAbsolute(rel);
  });
  if (outside.length > 0) {
    throw new BuildError(`Engine bundle takes input from outside ${root}: ${outside.join(", ")}`);
  }
  const out = result.outputFiles[0];
  if (out == null) throw new Error(`esbuild produced no output for ${file}`);
  return out.text;
}
