// The members of the page globals the converted modules provide, with the page's pako looked up on `page` each time
// it is used (never when this file loads), so the modules themselves read no global. engine.ts passes `globalThis`;
// the test loaders pass the window they build, so every host gets the same defaults and the same error texts.
import {
  create as createElevation,
  Elevation,
  type ElevationHost,
  type ElevationOptions,
  open as openElevation,
} from "./elevation.ts";
import { Estimates } from "./estimates.ts";
import {
  DEFLATE_LEVEL,
  type WriteOptions,
  type WrittenFile,
  FogWriter as writer,
} from "./fogWriter.ts";
import { ImportMessages } from "./importMessages.ts";
import { MD5 } from "./md5.ts";
import { bindOverpassHost, Overpass, type OverpassHost } from "./overpass.ts";
import { type FogMap, FogParser } from "./parser.ts";
import { bindPlannerHost, GraphPlanner, type PlannerHost } from "./planner.ts";
import { Reveal } from "./reveal.ts";
import { RouteLocal } from "./routeLocal.ts";
import { LocalRouter } from "./router.ts";
import { StreetCache } from "./streetCache.ts";
import { StreetMessages } from "./streetMessages.ts";
import { bindStreetsHost, StreetIndex, type StreetsHost } from "./streets.ts";
import { bindSuggestHost, type SuggestHost, SuggestTool } from "./suggest.ts";
import { memory, open as openStore, type StoreOptions } from "./tileStore.ts";
import { FogZip as zip } from "./unzip.ts";

// The two pako builds the page loads: the deflate one is parked as pakoDeflate by pakoDeflate.js, the inflate one is window.pako.
interface PakoInflate {
  inflate(bytes: Uint8Array): Uint8Array;
  inflateRaw(bytes: Uint8Array): Uint8Array;
}
interface PakoDeflate {
  deflate(bytes: Uint8Array, options: { level: number }): Uint8Array;
}
export interface PageWindow
  extends OverpassHost,
    ElevationHost,
    StreetsHost,
    PlannerHost,
    SuggestHost {
  pako?: PakoInflate;
  pakoDeflate?: PakoDeflate;
  indexedDB?: IDBFactory | null;
  [name: string]: unknown;
}

export function pageGlobals(page: PageWindow) {
  // Overpass keeps its state at module level, one instance for the bundle, so it has one host: the last window given.
  // It reads that window's fetch, `navigator.onLine` and `crossfogNextgisKey` each time a request, `has` or `cap` runs.
  bindOverpassHost(page);
  // StreetIndex likewise has one host for the bundle: `snapPoint` reads the page's Leaflet `L` when it runs.
  bindStreetsHost(page);
  // and the planner, which reads `L` when it resamples a plan's waypoints
  bindPlannerHost(page);
  // and the suggestion tool, which reads `L` and `matchMedia` when it draws or places a pin
  bindSuggestHost(page);
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
    // the module's own object, not a copy: callers and tests set its `_now`, `_setTimeout` and limits on it and the
    // module's functions read them there
    Overpass,
    TileStore: {
      open: (dbName: string, storeName: string, opts?: StoreOptions) =>
        openStore(page, dbName, storeName, opts),
      memory,
    },
    StreetCache: { ...StreetCache },
    // the constructor itself, not a copy: other files construct it and call its statics
    StreetIndex,
    // the constructors themselves, not copies: suggest.ts and the tests build them with `new` and patch prototypes
    GraphPlanner,
    LocalRouter,
    // an object of functions, so a copy like the others
    RouteLocal: { ...RouteLocal },
    // the constructor itself, with its `_internals`: main.js and the tests build it with `new`
    SuggestTool,
    StreetMessages: { ...StreetMessages },
    ImportMessages: { ...ImportMessages },
    Estimates: { ...Estimates },
    // fetch, createImageBitmap and OffscreenCanvas are looked up on `page` when a tile is fetched or decoded, and
    // IndexedDB when the store opens, never when the page global is built
    Elevation: {
      ...Elevation,
      create: (opts?: ElevationOptions) => createElevation(page, opts),
      open: (opts?: ElevationOptions) => openElevation(page, opts),
    },
  };
}
