import * as fflate from "fflate";
import { type PageWindow, pageGlobals } from "../../../app/src/pageGlobals.ts";

export interface UpstreamFogMap {
  tileCount: number;
  addTile(name: string, data: Uint8Array): boolean;
  isVisitedCell(cx: number, cy: number): boolean;
  addCells(cells: Int32Array): number;
  totalVisited(): number;
}

export interface UpstreamApi {
  unzip(zip: Uint8Array): Array<{ name: string; data: Uint8Array }>;
  newFogMap(): UpstreamFogMap;
  parseTileId(name: string): number | null;
  tileName(id: number): string;
  /** The page's fogWriter.ts run with fflate level 5 in place of pako level 5 (and fflate to read each file back): the tiles inflate to the same data, but the bytes can differ. */
  writeSync(fogMap: UpstreamFogMap): Array<{ name: string; bytes: Uint8Array }>;
}

let _cached: UpstreamApi | null = null;

function createUpstream(): UpstreamApi {
  const pako = {
    inflateRaw: (data: Uint8Array) => fflate.inflateSync(data),
    inflate: (data: Uint8Array) => fflate.unzlibSync(data),
  };
  // The page's engine.ts builds these with its own window; the modules are imported here, so they are the code the page runs.
  const { FogZip, FogParser, FogWriter } = pageGlobals({ pako } as unknown as PageWindow);

  return {
    unzip(zip: Uint8Array) {
      const buf =
        zip.byteOffset === 0 && zip.byteLength === zip.buffer.byteLength
          ? zip.buffer
          : zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
      return FogZip.unzip(buf as ArrayBuffer);
    },
    newFogMap(): UpstreamFogMap {
      return new FogParser.FogMap() as unknown as UpstreamFogMap;
    },
    parseTileId(name: string): number | null {
      return FogParser.parseTileId(name);
    },
    tileName: (id: number) => FogWriter.tileName(id),
    writeSync(fogMap) {
      return FogWriter.writeSync(fogMap as never, {
        deflate: (buf: Uint8Array) => fflate.zlibSync(buf, { level: 5 }),
        inflate: (buf: Uint8Array) => fflate.unzlibSync(buf),
      });
    },
  };
}

export function loadUpstream(): UpstreamApi {
  if (_cached === null) _cached = createUpstream();
  return _cached;
}

export function loadZipLikeDefog(zip: Uint8Array): {
  tiles: number;
  fogMap: UpstreamFogMap;
} {
  const up = loadUpstream();
  const fogMap = up.newFogMap();
  const entries = up.unzip(zip);
  let tiles = 0;
  for (const ent of entries) {
    const base = ent.name.split(/[\\/]/).pop() ?? "";
    try {
      if (fogMap.addTile(base, fflate.unzlibSync(ent.data))) tiles++;
    } catch {}
  }
  return { tiles, fogMap };
}
