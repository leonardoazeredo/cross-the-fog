import * as fflate from "fflate";
import { type PageWindow, pageGlobals } from "../../../../app/src/pageGlobals.ts";

// installFakeUpstream sets the converted modules' page globals on the test window as engine.ts does (these
// include ImportMessages) and wires up the same "zip input change" listener the real app uses. pako is
// shimmed with fflate since pako is not available in Node.
export function installFakeUpstream(win: Window, doc: Document): void {
  const winAny = win as unknown as Record<string, unknown>;

  winAny.pako = {
    inflateRaw: (data: Uint8Array) => fflate.inflateSync(data),
    inflate: (data: Uint8Array) => fflate.unzlibSync(data),
  };

  // The page's engine.ts assigns the converted modules' page globals this way (and binds Overpass to its window); the modules are imported here, so they are the code the page runs.
  Object.assign(winAny, pageGlobals(winAny as PageWindow));

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
