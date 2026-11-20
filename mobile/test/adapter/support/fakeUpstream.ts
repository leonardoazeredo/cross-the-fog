import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as fflate from "fflate";
import { type PageWindow, pageGlobals } from "../../../../app/src/pageGlobals.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findAppSrc(): string {
  // Walk up to the repo root where app/ and mobile/ sit side-by-side.
  // The extra levels handle Stryker's .stryker-tmp/ sandbox nesting.
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    dir = resolve(dir, "..");
    const candidate = resolve(dir, "app/src");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`app/src not found (searched up from ${__dirname})`);
}

const APP_SRC = findAppSrc();

// installFakeUpstream sets the converted modules' page globals on the test window as engine.ts does, loads
// the upstream app's importMessages.js into it via eval (the same way the mobile webview hosts it) and wires
// up the same "zip input change" listener the real app uses. pako is shimmed with fflate since pako is
// not available in Node.
export function installFakeUpstream(win: Window, doc: Document): void {
  const winAny = win as unknown as Record<string, unknown>;

  winAny.pako = {
    inflateRaw: (data: Uint8Array) => fflate.inflateSync(data),
    inflate: (data: Uint8Array) => fflate.unzlibSync(data),
  };

  // The page's engine.ts assigns the converted modules' page globals this way (and binds Overpass to its window); the modules are imported here, so they are the code the page runs.
  Object.assign(winAny, pageGlobals(winAny as PageWindow));
  (winAny.eval as (code: string) => void)(
    readFileSync(resolve(APP_SRC, "importMessages.js"), "utf-8"),
  );

  const FogParser = winAny.FogParser as {
    FogMap: new () => { addTile(name: string, data: Uint8Array): boolean };
  };
  const FogZip = winAny.FogZip as {
    unzip(buf: ArrayBuffer): Array<{ name: string; data: Uint8Array }>;
  };

  const ImportMessages = winAny.ImportMessages as {
    tally(): { added: number; corrupt: number };
    decode(t: unknown, name: string, bytes: Uint8Array, env: unknown): void;
  };
  const parseTileId = (FogParser as unknown as { parseTileId(name: string): number | null })
    .parseTileId;

  const fogMap = new FogParser.FogMap();
  // main.js publishes the damaged-tile count of the latest import here; the loader hook reads it
  const importStats = { corrupt: 0 };
  winAny.CrossfogPage = { lastImport: importStats };

  doc.getElementById("zip")?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    importStats.corrupt = 0;
    const buf = await file.arrayBuffer();
    let entries: Array<{ name: string; data: Uint8Array }>;
    try {
      entries = FogZip.unzip(buf);
    } catch {
      return;
    }
    const tally = ImportMessages.tally();
    for (const ent of entries) {
      const base = ent.name.split(/[\\/]/).pop() ?? "";
      ImportMessages.decode(tally, base, ent.data, {
        fogMap,
        inflate: fflate.unzlibSync,
        parseTileId,
        tileName: (winAny.FogWriter as { tileName(id: number): string }).tileName,
      });
    }
    importStats.corrupt = tally.corrupt;
  });
}
