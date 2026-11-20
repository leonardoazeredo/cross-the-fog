// What the street index keeps: the tiles it holds, the ways and their scoring segments, the fog
// scores, and the eviction near the cap. How tiles arrive is streetDownload.ts, which reaches this
// only through the StreetSeam interface there.
import { type Tile, type TileAnswer, tileId, tileOf, type Vertex, type Way } from "./streetGrid.ts";

// What snapPoint reads from the page, looked up on the host when it runs, never at load: pageGlobals.ts passes the
// page's own object.
export interface StreetsHost {
  L?: { latLng(lat: number, lng: number): unknown };
}

let host: StreetsHost | null = null;
export function bindStreetsHost(h: StreetsHost): void {
  host = h;
}

interface Segment {
  x: number;
  y: number;
  lon: number;
  lat: number;
  lenM: number;
  frac: number | null;
}
export interface StoreOptions {
  newFrac: (lon: number, lat: number) => number;
  fogVersion?: () => number;
  maxSegs?: number;
}
// The store as its methods see it: `this` in each prototype function below.
export interface StreetStoreSelf {
  newFrac: StoreOptions["newFrac"];
  fogVersion: () => number;
  fracFog: number;
  segs: Map<string, Segment[]>;
  tiles: Set<string>;
  wayIds: Set<number>;
  ways: Way[];
  segCount: number;
  maxSegs: number;
  wayFrom: Map<number, { from: Set<string>; segs: Segment[] }>;
  pieceWays: Map<string, Set<number>>;
  used: Map<string, boolean>;
  runs: Set<Set<string>>;
  holds: Map<string, Set<string>>;
  version: number;
  kx: number | null;
  ky: number;
  _read(answer: TileAnswer, from: Tile): void;
  _use(pos: string): void;
  _makeRoom(): void;
  _addWay(w: Way): void;
  _dropWays(ids: number[]): void;
  _cover(tiles: Tile[]): void;
  _anchor(lat: number): void;
  _syncFog(): void;
  _holds(t: Tile): boolean;
  _protect(under: Set<string>, holdAs?: string): () => void;
}

const SEG_M = 50; // ways are chopped into ~50 m scoring segments
const GRID_M = 250; // spatial bin size for radius queries
const MAX_SEGS = 400000; // memory guard (~40 MB worst case)
// Past EVICT_AT of the cap a read first drops the least recently used pieces, down to EVICT_TO (see
// _makeRoom): the 15% left above EVICT_AT is room for the pieces one read brings before the cap cuts
// a way short, and dropping to EVICT_TO frees room for several reads, not one drop per read
const EVICT_AT = 0.85,
  EVICT_TO = 0.7;
const CORRIDOR_M = 30; // full width Fog of World clears as you travel

export function StreetStore(this: StreetStoreSelf, opts: StoreOptions) {
  this.newFrac = opts.newFrac; // (lon,lat) -> 0..1 share of the corridor stamp still fogged
  // () -> a number that changes whenever the fog does: the cached shares are dropped when it moves
  this.fogVersion = opts.fogVersion || (() => 0);
  this.fracFog = this.fogVersion(); // the fog the cached shares were scored on
  this.segs = new Map(); // "gx,gy" -> [{x,y,lon,lat,lenM,frac}]
  this.tiles = new Set(); // fetched coverage, tileId
  this.wayIds = new Set(); // dedupe across overlapping fetches
  this.ways = []; // raw {id,nodes,geometry}: shared node ids give the
  // route planner its graph connectivity for free
  this.segCount = 0;
  this.maxSegs = opts.maxSegs || MAX_SEGS;
  // what a piece's eviction needs: id -> {from: the tile keys whose answer lists the way, segs: its scoring
  // segments} for every way held, and "x:y" -> the ids of the ways a read
  // of that piece listed (it can still name ways dropped since)
  this.wayFrom = new Map();
  this.pieceWays = new Map();
  this.used = new Map(); // "x:y" of every piece read or under a run's rects, least recently used first
  this.runs = new Set(); // the "x:y" under the rects of each ensureRects still running: never evicted
  this.holds = new Map(); // _protect's holdAs -> the "x:y" under that caller's latest run: never evicted until its next one
  this.version = 0; // bumped by every tile read into the index, so graphs built from this notice list changes
  this.kx = null;
  this.ky = 110540; // metre frame, anchored on first fetch
}

const holds = (set: Set<string>, t: Tile) => set.has(tileId(t));
const cellKey = (x: number, y: number) => Math.floor(x / GRID_M) + "," + Math.floor(y / GRID_M);

StreetStore.prototype._anchor = function (this: StreetStoreSelf, lat: number) {
  if (this.kx === null) this.kx = 111320 * Math.cos((lat * Math.PI) / 180);
};

StreetStore.prototype.covered = function (this: StreetStoreSelf, lat: number, lng: number) {
  return holds(this.tiles, tileOf(lng, lat));
};

StreetStore.prototype._addWay = function (this: StreetStoreSelf, w: Way) {
  if (!w.geometry || w.geometry.length < 2 || this.wayIds.has(w.id)) return;
  this.wayIds.add(w.id);
  const entry = { from: new Set<string>(), segs: [] as Segment[] };
  this.wayFrom.set(w.id, entry);
  if (w.nodes && w.nodes.length === w.geometry.length)
    this.ways.push({ id: w.id, nodes: w.nodes, geometry: w.geometry });
  for (let i = 1; i < w.geometry.length && this.segCount < this.maxSegs; i++) {
    const a = w.geometry[i - 1] as Vertex,
      b = w.geometry[i] as Vertex;
    const ax = a.lon * (this.kx as number),
      ay = a.lat * this.ky;
    const bx = b.lon * (this.kx as number),
      by = b.lat * this.ky;
    const edgeM = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(edgeM / SEG_M));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const x = ax + (bx - ax) * t,
        y = ay + (by - ay) * t;
      const key = cellKey(x, y);
      let cell: Segment[] | undefined = this.segs.get(key);
      if (!cell) {
        cell = [];
        this.segs.set(key, cell);
      }
      const seg: Segment = {
        x,
        y,
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        lenM: edgeM / n,
        frac: null,
      };
      cell.push(seg);
      entry.segs.push(seg);
      this.segCount++;
    }
  }
};

// Takes out the ways no piece lists after an eviction. The MAX_SEGS share must be given back and every
// list the way joined must forget it, or a way read again would count twice.
StreetStore.prototype._dropWays = function (this: StreetStoreSelf, ids: number[]) {
  if (!ids.length) return;
  const gone = new Set(ids),
    dead = new Map();
  for (const id of ids) {
    for (const seg of (this.wayFrom.get(id) as { segs: Segment[] }).segs) {
      const key = cellKey(seg.x, seg.y);
      if (!dead.has(key)) dead.set(key, new Set());
      dead.get(key).add(seg);
    }
    this.wayFrom.delete(id);
    this.wayIds.delete(id);
  }
  for (const [key, segs] of dead) {
    const live = (this.segs.get(key) as Segment[]).filter((seg) => !segs.has(seg));
    if (live.length) this.segs.set(key, live);
    else this.segs.delete(key);
    this.segCount -= segs.size;
  }
  this.ways = this.ways.filter((w) => !gone.has(w.id));
};

StreetStore.prototype._use = function (this: StreetStoreSelf, pos: string) {
  this.used.delete(pos);
  this.used.set(pos, true);
};

// Near the cap, drops the least recently used pieces that no running or held run covers: the piece
// stops counting as held (a run asks for it again), and a way goes once no held piece lists it.
StreetStore.prototype._makeRoom = function (this: StreetStoreSelf) {
  if (this.segCount <= this.maxSegs * EVICT_AT) return;
  const kept = [...this.runs, ...this.holds.values()];
  const evicted = [],
    gone = [];
  let left = this.segCount;
  for (const pos of this.used.keys()) {
    if (left <= this.maxSegs * EVICT_TO) break;
    if (kept.some((under) => under.has(pos))) continue;
    evicted.push(pos);
    this.tiles.delete(pos);
    for (const id of this.pieceWays.get(pos) || []) {
      const entry = this.wayFrom.get(id);
      if (!entry || !entry.from.delete(pos)) continue;
      if (!entry.from.size) {
        gone.push(id);
        left -= entry.segs.length;
      }
    }
    this.pieceWays.delete(pos);
  }
  if (!evicted.length) return;
  for (const pos of evicted) this.used.delete(pos);
  this._dropWays(gone);
};

StreetStore.prototype._cover = function (this: StreetStoreSelf, tiles: Tile[]) {
  for (const t of tiles) this.tiles.add(tileId(t));
};

// Round a point to a ~0.006 degree grid (about 420-670 m at 51°N). Callers build the fetch
// area around the rounded centre, so any run whose pin lands in the same grid
// cell produces the identical area and reuses the cache: pressing Suggest
// again, or after a small pin nudge, doesn't trigger a fresh download. The
// fetch area's own margin (hundreds of metres) absorbs the rounding offset.
StreetStore.prototype.snapPoint = function (
  this: StreetStoreSelf,
  latlng: { lat: number; lng: number },
  g?: number,
) {
  g = g || 0.006;
  if (!host?.L) throw new ReferenceError("L is not defined");
  return host.L.latLng(Math.round(latlng.lat / g) * g, Math.round(latlng.lng / g) * g);
};

// One tile's answer ({x, y}) into the index; the version bump tells graphs built before it to rebuild.
// A way is held while any tile brings it, and splitAnswer hands a whole way to every tile it touches,
// so a way across two tiles is added once and listed by both.
StreetStore.prototype._read = function (this: StreetStoreSelf, answer: TileAnswer, from: Tile) {
  // without its tile a read could not say which piece holds what it brings
  if (!from) throw new TypeError("streets: _read needs the tile it reads");
  const pos = tileId(from);
  try {
    this._use(pos);
    this._makeRoom();
    for (const w of answer.ways) {
      this._addWay(w);
      // every piece whose answer lists the way holds it, so an eviction keeps a way another piece still lists
      if (this.wayIds.has(w.id)) {
        (this.wayFrom.get(w.id) as { from: Set<string> }).from.add(pos);
        if (!this.pieceWays.has(pos)) this.pieceWays.set(pos, new Set());
        (this.pieceWays.get(pos) as Set<number>).add(w.id);
      }
    }
  } finally {
    // a throw midway leaves ways added or evicted: the graphs built before must still rebuild
    this.version++;
  }
};

// Defoggable area (m²) reachable by travelling the ways within rM of the
// point: sum of segment length x corridor width x still-fogged share of the
// corridor. Segments are scored against the fog lazily and cached (the fog
// is static while planning, and when it moves the shares are dropped, see _syncFog). Only meaningful
// where covered() is true.
StreetStore.prototype.newAreaM2 = function (
  this: StreetStoreSelf,
  latlng: { lat: number; lng: number },
  rM: number,
) {
  if (this.kx === null) return 0;
  this._syncFog();
  const px = latlng.lng * this.kx,
    py = latlng.lat * this.ky;
  const g0x = Math.floor((px - rM) / GRID_M),
    g1x = Math.floor((px + rM) / GRID_M);
  const g0y = Math.floor((py - rM) / GRID_M),
    g1y = Math.floor((py + rM) / GRID_M);
  const r2 = rM * rM;
  let m2 = 0;
  for (let gy = g0y; gy <= g1y; gy++)
    for (let gx = g0x; gx <= g1x; gx++) {
      const cell = this.segs.get(gx + "," + gy);
      if (!cell) continue;
      for (const s of cell) {
        const dx = s.x - px,
          dy = s.y - py;
        if (dx * dx + dy * dy > r2) continue;
        if (s.frac === null) s.frac = this.newFrac(s.lon, s.lat);
        // linear frac deliberately: sqrt (softer on rewalked grids) and raw
        // street metres both benchmarked worse; length x fogged-share is also
        // exactly the quantity computeGain rewards
        m2 += s.lenM * CORRIDOR_M * s.frac;
      }
    }
  return m2;
};

// The fog moved (cells revealed or taken back): every segment is judged against it again. `version`
// stays put: a graph stamps the fog version itself, and a bump from inside a read would turn a graph
// held by a running suggestion not-current in the middle of it.
StreetStore.prototype._syncFog = function (this: StreetStoreSelf) {
  const fog = this.fogVersion();
  if (fog === this.fracFog) return;
  this.fracFog = fog;
  for (const cell of this.segs.values()) for (const s of cell) s.frac = null;
};

// Whether the tile is held.
StreetStore.prototype._holds = function (this: StreetStoreSelf, t: Tile) {
  return holds(this.tiles, t);
};

// Marks the pieces under a run's rects as in use and keeps them from eviction until the run ends
// (the returned release), and, for a named caller, until that caller's next run.
StreetStore.prototype._protect = function (
  this: StreetStoreSelf,
  under: Set<string>,
  holdAs?: string,
) {
  for (const pos of under) this._use(pos);
  if (holdAs) this.holds.set(holdAs, under);
  this.runs.add(under);
  return () => {
    this.runs.delete(under);
  };
};
