// The members of the page globals the converted modules provide, with the page's pako looked up on `page` each time
// it is used (never when this file loads), so the modules themselves read no global. engine.ts passes `globalThis`;
// the test loaders pass the window they build, so every host gets the same defaults and the same error texts.
import {
  DEFLATE_LEVEL,
  type WriteOptions,
  type WrittenFile,
  FogWriter as writer,
} from "./fogWriter.ts";
import { MD5 } from "./md5.ts";
import { type FogMap, FogParser } from "./parser.ts";
import { Reveal } from "./reveal.ts";
import { FogZip as zip } from "./unzip.ts";

// The two pako builds the page loads: the deflate one is parked as pakoDeflate by pakoDeflate.js, the inflate one is window.pako.
interface PakoInflate {
  inflate(bytes: Uint8Array): Uint8Array;
  inflateRaw(bytes: Uint8Array): Uint8Array;
}
interface PakoDeflate {
  deflate(bytes: Uint8Array, options: { level: number }): Uint8Array;
}
export interface PageWindow {
  pako?: PakoInflate;
  pakoDeflate?: PakoDeflate;
  [name: string]: unknown;
}

export function pageGlobals(page: PageWindow) {
  // `deflate` defaults to the pako build the page loads (see pakoDeflate.js) and `inflate`, which reads every file
  // back before it is handed out, to the inflate build left in window.pako; `opts` overrides either.
  const writeSync = (fogMap: FogMap, opts?: Partial<WriteOptions>): WrittenFile[] => {
    let deflate = opts?.deflate;
    if (!deflate) {
      if (!page.pakoDeflate || typeof page.pakoDeflate.deflate !== "function") {
        throw new Error(
          "writeSync needs a deflate function or the pako deflate build (vendor/pako_deflate.min.js, then src/pakoDeflate.js, before pako_inflate.min.js)",
        );
      }
      deflate = (buf) => (page.pakoDeflate as PakoDeflate).deflate(buf, { level: DEFLATE_LEVEL });
    }
    let inflate = opts?.inflate;
    if (!inflate) {
      if (!page.pako || typeof page.pako.inflate !== "function") {
        throw new Error(
          "writeSync needs an inflate function or the pako inflate build (vendor/pako_inflate.min.js) to check what it wrote",
        );
      }
      inflate = (buf) => (page.pako as PakoInflate).inflate(buf);
    }
    return writer.writeSync(fogMap, { deflate, inflate });
  };
  return {
    // copies, so a host that replaces or patches a member leaves the module's own objects alone
    FogParser: { ...FogParser },
    MD5: { ...MD5 },
    FogWriter: { tileName: writer.tileName, writeTile: writer.writeTile, writeSync },
    FogZip: {
      unzip: (buffer: ArrayBuffer) =>
        zip.unzip(buffer, {
          inflateRaw: (data) => {
            if (!page.pako) throw new ReferenceError("pako is not defined");
            return page.pako.inflateRaw(data);
          },
        }),
    },
    Reveal: { ...Reveal },
  };
}
