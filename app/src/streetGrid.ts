// The street grid and the shapes both halves of the street index share. A tile is TILE_DEG degrees
// square: streets are fetched and remembered per tile, and "x:y" (tileId) is its key in every Map and
// Set keyed by tile.

export interface Tile {
  x: number;
  y: number;
}
export interface Rect {
  s: number;
  w: number;
  n: number;
  e: number;
}
export interface Vertex {
  lat: number;
  lon: number;
}
export interface Way {
  id: number;
  nodes?: number[];
  geometry?: Vertex[];
}
export interface TileAnswer {
  ways: Way[];
  groups: Record<string, never>;
}

export const TILE_DEG = 0.025; // fetch grid, ~2.8 x 1.75 km at 51°N: streets are fetched and remembered per tile; changing it means bumping the version in streetCache.ts keys
const TILE_EPS = 1e-9; // in tiles: keeps a bound that sits on a tile edge from reaching into the neighbouring tile

export const tileOf = (lng: number, lat: number) => ({
  x: Math.floor(lng / TILE_DEG),
  y: Math.floor(lat / TILE_DEG),
});
// "x:y", the key of a piece in every Map and Set keyed by tile
export const tileId = (t: Tile) => t.x + ":" + t.y;

// A bound on a tile edge takes the tile on its inside (a west or south edge the tile it opens, an
// east or north edge the tile it closes), so a tile's own bounds map back to it; a rect with
// no width still takes one tile.
export const tilesCovering = ({ s, w, n, e }: Rect) => {
  const x0 = Math.floor(w / TILE_DEG + TILE_EPS),
    y0 = Math.floor(s / TILE_DEG + TILE_EPS);
  const x1 = Math.max(x0, Math.ceil(e / TILE_DEG - TILE_EPS) - 1),
    y1 = Math.max(y0, Math.ceil(n / TILE_DEG - TILE_EPS) - 1);
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles;
};
// Every tile under the rects, each once.
export const tilesOf = (rects: Rect[]) => {
  const seen = new Set();
  return rects
    .flatMap((r) => tilesCovering(r))
    .filter((t) => {
      const k = tileId(t);
      return !seen.has(k) && seen.add(k);
    });
};
export const tileBounds = ({ x, y }: Tile) => ({
  s: y * TILE_DEG,
  w: x * TILE_DEG,
  n: (y + 1) * TILE_DEG,
  e: (x + 1) * TILE_DEG,
});

// Sorts tiles in place by distance from the centre of the rects' bounding box, longitude scaled to
// ground distance at that latitude; equal distances keep their order.
export const nearestFirst = (tiles: Tile[], rects: Rect[]) => {
  const s = Math.min(...rects.map((r) => r.s)),
    n = Math.max(...rects.map((r) => r.n));
  const w = Math.min(...rects.map((r) => r.w)),
    e = Math.max(...rects.map((r) => r.e));
  const lat = (s + n) / 2,
    lng = (w + e) / 2,
    kx = Math.cos((lat * Math.PI) / 180);
  const d = (t: Tile) =>
    Math.hypot(((t.x + 0.5) * TILE_DEG - lng) * kx, (t.y + 0.5) * TILE_DEG - lat);
  tiles.sort((a, b) => d(a) - d(b));
};
