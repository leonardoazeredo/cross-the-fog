import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function bundleAdapter(opts: { devTools: boolean }): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [resolve(ROOT, "web-adapter/index.ts")],
    bundle: true,
    format: "iife",
    target: ["safari16.4", "chrome120"],
    minify: true,
    write: false,
    define: {
      __CROSSFOG_DEV_TOOLS__: String(opts.devTools),
      CACHE_ENABLED: "true",
      CRYPTO_SUBTLE: "true",
    },
    external: ["@noble/hashes/sha256", "@noble/hashes/utils"],
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error("esbuild produced no output for the adapter");
  return output.text;
}
