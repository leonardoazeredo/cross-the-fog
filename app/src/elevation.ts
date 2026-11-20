// Ground height from the AWS Open Data terrain tiles (terrarium PNG encoding), fetched by tile and
// kept in a TileStore. Only the tile coordinates leave the page; see README "Privacy".
import { memory, open as openStore, type StoreHost, type TileStoreApi } from "./tileStore.ts";

// What the default tile source and decoder read from the page, looked up on the host each time they run, never at
// load: pageGlobals.ts passes the page's own object. AbortController, Blob and the timers are platform built-ins.
export interface ElevationHost extends StoreHost {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  createImageBitmap?: (image: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
}

export interface TileImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface ElevationOptions {
  store?: TileStoreApi;
  fetchTile?: (z: number, x: number, y: number) => Promise<Uint8Array>;
  decodeTile?: (bytes: Uint8Array) => Promise<TileImage>;
}

const ZOOM = 12; // ~38 m a pixel at the equator; the finest sources are SRTM and 3DEP, coarser GMTED2010 fills other areas
const TILE = 256;
const MAX_IN_FLIGHT = 4;
const FETCH_TIMEOUT_MS = 30000;
const MAX_DECODED = 8; // caps decoded pixels at about 2 MB (256 KB each); an evicted tile is read from the store again, or refetched when the store lost it
const BASE = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium";

export function decodeHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

// Web Mercator; px/py are fractional pixels inside the tile (pixel i covers [i, i+1))
export function tileOf(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const x = Math.floor(fx),
    y = Math.floor(fy);
  return { x, y, px: (fx - x) * TILE, py: (fy - y) * TILE };
}

async function defaultFetchTile(
  host: ElevationHost,
  z: number,
  x: number,
  y: number,
): Promise<Uint8Array> {
  // a stalled connection would otherwise hold elevationAt, and every later call for the tile, forever
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    if (!host.fetch) throw new TypeError("fetch is not available");
    const res = await host.fetch(`${BASE}/${z}/${x}/${y}.png`, { signal: ctl.signal });
    if (!res.ok) throw new Error("elevation tile " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// no colour conversion or premultiplying, so the bytes read back are the bytes encoded
async function defaultDecodeTile(host: ElevationHost, bytes: Uint8Array): Promise<TileImage> {
  if (!host.createImageBitmap || !host.OffscreenCanvas)
    throw new TypeError("image decoding is not available");
  const bmp = await host.createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const canvas = new host.OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bmp, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width, height, data };
  } finally {
    bmp.close();
  }
}

export function create(host: ElevationHost, opts?: ElevationOptions) {
  const o = opts || {};
  const store = o.store || memory({ maxEntries: 200 });
  const fetchTile =
    o.fetchTile || ((z: number, x: number, y: number) => defaultFetchTile(host, z, x, y));
  const decodeTile = o.decodeTile || ((bytes: Uint8Array) => defaultDecodeTile(host, bytes));
  const decoded = new Map<string, Promise<TileImage | null>>(); // key -> Promise<image|null>, oldest first
  const warned = new Set<string>();

  // null alone cannot tell offline from a blocked host or a broken decoder; one line per distinct stage and
  // error class says which. A message can hold the tile URL or its number, so it is never logged, and a name
  // that is no plain identifier is not either; any other thrown non-object (a string, a number) is named by its type
  function warnOnce(stage: string, e: unknown): void {
    const name = e !== null && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
    const kind =
      typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)
        ? name
        : e !== null && typeof e !== "object"
          ? typeof e
          : "unknown";
    const reason = stage + " failed: " + kind;
    if (warned.has(reason)) return;
    warned.add(reason);
    console.warn("elevation tile not loaded, " + reason);
  }

  // resolves to the decoded tile, or null when it can be neither read from the store nor fetched and decoded
  async function loadTile(z: number, x: number, y: number): Promise<TileImage | null> {
    const key = `${z}/${x}/${y}`;
    let bytes: Uint8Array | undefined;
    try {
      bytes = (await store.get(key)) as Uint8Array | undefined;
    } catch (e) {
      bytes = undefined;
    }
    if (bytes) {
      try {
        return await decodeTile(bytes);
      } catch (e) {
        // a cached copy that fails to decode would fail on every call until it is dropped
        try {
          await store.delete(key);
        } catch (e2) {
          /* nothing more to do */
        }
      }
    }
    try {
      bytes = await fetchTile(z, x, y);
    } catch (e) {
      warnOnce("fetch", e);
      return null;
    }
    let image: TileImage;
    try {
      image = await decodeTile(bytes);
    } catch (e) {
      warnOnce("decode", e);
      return null;
    }
    try {
      await store.put(key, bytes);
    } catch (e) {
      /* a full or broken store only costs a refetch */
    }
    return image;
  }

  function tile(z: number, x: number, y: number): Promise<TileImage | null> {
    const key = `${z}/${x}/${y}`;
    let p = decoded.get(key);
    if (p) {
      decoded.delete(key);
      decoded.set(key, p);
      return p;
    }
    p = loadTile(z, x, y);
    // a miss is not kept: the next call tries the network again
    p.then((img) => {
      if (!img && decoded.get(key) === p) decoded.delete(key);
    });
    decoded.set(key, p);
    while (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value as string);
    return p;
  }

  // bilinear between the four nearest pixel centres; at a tile edge the edge pixel stands in
  // for the neighbour, which is under half a pixel of error
  function sample(img: TileImage, px: number, py: number): number | null {
    const fx = px - 0.5,
      fy = py - 0.5;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const cl = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
    const h = (x: number, y: number) => {
      const i = (cl(y, img.height) * img.width + cl(x, img.width)) * 4;
      return decodeHeight(
        img.data[i] as number,
        img.data[i + 1] as number,
        img.data[i + 2] as number,
      );
    };
    const top = h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx;
    const bottom = h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx;
    const height = top * (1 - ty) + bottom * ty;
    return Number.isFinite(height) ? height : null;
  }

  async function elevationAt(points: unknown): Promise<Array<number | null>> {
    if (!Array.isArray(points)) return [];
    const out: Array<number | null> = new Array(points.length).fill(null);
    const byTile = new Map<
      string,
      { x: number; y: number; items: Array<{ i: number; px: number; py: number }> }
    >(); // key -> {x, y, items: [{i, px, py}]}
    const n = 2 ** ZOOM;
    points.forEach((pt: unknown, i: number) => {
      const lon = pt && (pt as number[])[0],
        lat = pt && (pt as number[])[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const t = tileOf(lon as number, lat as number, ZOOM);
      if (t.x < 0 || t.x >= n || t.y < 0 || t.y >= n) return; // off the map: nothing to ask for
      const key = t.x + "/" + t.y;
      if (!byTile.has(key)) byTile.set(key, { x: t.x, y: t.y, items: [] });
      (byTile.get(key) as { items: Array<{ i: number; px: number; py: number }> }).items.push({
        i,
        px: t.px,
        py: t.py,
      });
    });
    const queue = [...byTile.values()];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const img = await tile(ZOOM, t.x, t.y);
        if (img) for (const it of t.items) out[it.i] = sample(img, it.px, it.py);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, queue.length) }, worker));
    return out;
  }

  return { elevationAt };
}

// the page's own instance: tiles kept in IndexedDB, memory when that is unavailable
export async function open(host: ElevationHost, opts?: ElevationOptions) {
  const store = await openStore(host, "crossfog-elevation", "tiles", { maxEntries: 200 });
  return create(host, { ...opts, store });
}

// the heights if they come within ms, else fallback: a wait for them must end even when a tile never does
export function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// What the page's `window.Elevation` holds once pageGlobals.ts has bound `create` and `open` to the page.
export const Elevation = { create, open, within, tileOf, decodeHeight };
