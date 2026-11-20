// Street-aware reward data for route suggestions.
// Fetches street geometry for small areas from Overpass (OpenStreetMap) and
// answers one question: how much AREA could still be defogged by travelling
// the ways within reach of a point? Each way segment is weighted by the share
// of its ~30 m corridor that is still fogged, so a lone path through virgin
// meadow (huge corridor gain) outscores its low street-metre count, and a
// half-rewalked grid doesn't get overcounted. Raw fog alone can't tell a
// street grid from a lake; street metres alone can't tell a rich meadow path
// from a rewalked alley. Privacy: Overpass only ever sees bounding boxes, the
// same class of information the basemap tile servers already get. The fog
// itself never leaves the device (segments are scored against it locally).
import { Overpass } from "./overpass.ts";

// What snapPoint reads from the page, looked up on the host when it runs, never at load: pageGlobals.ts passes the
// page's own object.
export interface StreetsHost {
  L?: { latLng(lat: number, lng: number): unknown };
}

let host: StreetsHost | null = null;
export function bindStreetsHost(h: StreetsHost): void {
  host = h;
}

interface Tile {
  x: number;
  y: number;
}
interface Rect {
  s: number;
  w: number;
  n: number;
  e: number;
}
interface Vertex {
  lat: number;
  lon: number;
}
interface Way {
  id: number;
  nodes?: number[];
  geometry?: Vertex[];
}
interface TileAnswer {
  ways: Way[];
  groups: Record<string, never>;
}
interface Segment {
  x: number;
  y: number;
  lon: number;
  lat: number;
  lenM: number;
  frac: number | null;
}
interface StreetError extends Error {
  reason?: string;
  retryAt?: number;
  done?: number;
  total?: number;
  cause?: StreetError;
}
interface RunOptions {
  now?: () => number;
  wait?: (until: number) => Promise<boolean>;
  stale?: () => boolean;
}
type Source = (
  tiles: Tile[],
  onTile: (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => void,
  opts?: RunOptions,
) => Promise<Map<string, TileAnswer | undefined>>;
interface StreetIndexOptions {
  newFrac: (lon: number, lat: number) => number;
  fogVersion?: () => number;
  fetchStreets?: Source;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  every?: (fn: () => void, ms: number) => () => void;
  maxSegs?: number;
}
interface EnsureOptions {
  onProgress?: (p: { done: number; total: number; waitUntil?: number }) => void;
  deadlineMs?: number | null;
  stale?: () => boolean;
  holdAs?: string;
  now?: () => number;
}
interface Claim {
  key: string;
  promise: Promise<unknown>;
  done: (via?: { cached?: boolean }) => void;
}
// The index as its methods see it: `this` in each prototype function below.
interface Self {
  newFrac: StreetIndexOptions["newFrac"];
  fogVersion: () => number;
  fracFog: number;
  fetchStreets: Source;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  every: (fn: () => void, ms: number) => () => void;
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
  inFlight: Map<string, Claim>;
  kx: number | null;
  ky: number;
  _read(answer: TileAnswer, from: Tile): void;
  _use(pos: string): void;
  _makeRoom(): void;
  _addWay(w: Way): void;
  _dropWays(ids: number[]): void;
  _uncovered(rects: Rect[]): Tile[];
  _cover(tiles: Tile[]): void;
  _anchor(lat: number): void;
  _syncFog(): void;
  _ensureRects(rects: Rect[], opts?: EnsureOptions): Promise<{ done: number; total: number }>;
}

// Streets someone would plausibly cover on foot. Driveways and
// parking aisles are excluded: they're numerous and nobody hunts them.
// Besides what people cover, the list holds trunk roads, link roads and steps:
// routing needs their junctions, or side streets that reach the network only through
// a main road are cut off
const CONNECT_HW = "trunk|trunk_link|primary_link|secondary_link|tertiary_link";
const RUN_HW =
  "residential|unclassified|tertiary|secondary|primary|living_street|track|path|footway|cycleway|pedestrian|steps|" +
  CONNECT_HW;
const SEG_M = 50; // ways are chopped into ~50 m scoring segments
const GRID_M = 250; // spatial bin size for radius queries
const MAX_SEGS = 400000; // memory guard (~40 MB worst case)
// Past EVICT_AT of the cap a read first drops the least recently used pieces, down to EVICT_TO (see
// _makeRoom): the 15% left above EVICT_AT is room for the pieces one read brings before the cap cuts
// a way short, and dropping to EVICT_TO frees room for several reads, not one drop per read
const EVICT_AT = 0.85,
  EVICT_TO = 0.7;
const CORRIDOR_M = 30; // full width Fog of World clears as you travel
const TILE_DEG = 0.025; // fetch grid, ~2.8 x 1.75 km at 51°N: streets are fetched and remembered per tile; changing it means bumping the version in streetCache.ts keys
const TILE_EPS = 1e-9; // in tiles: keeps a bound that sits on a tile edge from reaching into the neighbouring tile
// a run sends no further request past this (the requests already open finish and keep all their
// tiles), so a server that never recovers ends it with its progress; long, because every request
// can spend a minute or more in the queue
const RUN_DEADLINE_MS = 1200000;
// waits before asking again after a busy answer (429, 502, 504); busy answers while a wait is set
// are one step, and a busy answer after the third wait ends the run unless an answer lands while
// the requests open with it are still running, so it ends the same whichever of them lands first
const BUSY_RETRY_MS = [15000, 30000, 60000];
// how often a waiting run checks stale() (a busy wait, whose deadline is checked before it starts) or
// stale() and its deadline (a wait for another run's tile): a replaced run must not hold its tiles
// until a busy wait runs out or the other run ends
const STALE_POLL_MS = 1000;
// the reasons a street source fails with (Overpass.post's, "superseded" among them, which the run's
// own stop also uses); an error with none of them is a bug, which is never worded or wrapped as a
// failed download. The street cache keeps its own list of outages (OUTAGE_REASONS, without
// superseded): add a new Overpass outage reason to both.
const STREET_REASONS = new Set(["busy", "blocked", "stalled", "offline", "server", "superseded"]);

function StreetIndex(this: Self, opts: StreetIndexOptions) {
  this.newFrac = opts.newFrac; // (lon,lat) -> 0..1 share of the corridor stamp still fogged
  // () -> a number that changes whenever the fog does: the cached shares are dropped when it moves
  this.fogVersion = opts.fogVersion || (() => 0);
  this.fracFog = this.fogVersion(); // the fog the cached shares were scored on
  // the street source: (tiles, onTile, opts) -> Map "x:y" -> answer, calling onTile(tile, answer) as
  // each arrives (a source may return some tiles in the Map alone); opts is {now, wait, stale}
  this.fetchStreets = opts.fetchStreets || StreetIndex.overpassFetch;
  this.now = opts.now || Date.now; // the clock the run deadline is measured on
  this.sleep = opts.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  // (fn, ms) -> stop: calls fn every ms until stopped, the clock a waiting run checks stale() on
  this.every =
    opts.every ||
    ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  this.segs = new Map(); // "gx,gy" -> [{x,y,lon,lat,lenM,frac}]
  this.tiles = new Set(); // fetched coverage, StreetIndex.tileId
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
  this.holds = new Map(); // opts.holdAs -> the "x:y" under that caller's latest run: never evicted until its next one
  this.version = 0; // bumped by every tile read into the index, so graphs built from this notice list changes
  this.inFlight = new Map(); // StreetIndex.tileId -> {key, promise, done}: a tile a running ensureRects is asking for, which a later run waits for
  this.kx = null;
  this.ky = 110540; // metre frame, anchored on first fetch
}

const holds = (set: Set<string>, t: Tile) => set.has(StreetIndex.tileId(t));
const cellKey = (x: number, y: number) => Math.floor(x / GRID_M) + "," + Math.floor(y / GRID_M);

StreetIndex.prototype._anchor = function (this: Self, lat: number) {
  if (this.kx === null) this.kx = 111320 * Math.cos((lat * Math.PI) / 180);
};

StreetIndex.prototype.covered = function (this: Self, lat: number, lng: number) {
  return holds(this.tiles, StreetIndex.tileOf(lng, lat));
};

StreetIndex.prototype._addWay = function (this: Self, w: Way) {
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
StreetIndex.prototype._dropWays = function (this: Self, ids: number[]) {
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

StreetIndex.prototype._use = function (this: Self, pos: string) {
  this.used.delete(pos);
  this.used.set(pos, true);
};

// Near the cap, drops the least recently used pieces that no running or held run covers: the piece
// stops counting as held (a run asks for it again), and a way goes once no held piece lists it.
StreetIndex.prototype._makeRoom = function (this: Self) {
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

StreetIndex.prototype._uncovered = function (this: Self, rects: Rect[]) {
  return StreetIndex.tilesOf(rects).filter((t) => !holds(this.tiles, t));
};

StreetIndex.prototype._cover = function (this: Self, tiles: Tile[]) {
  for (const t of tiles) this.tiles.add(StreetIndex.tileId(t));
};

// Round a point to a ~0.006 degree grid (~450-650 m). Callers build the fetch
// area around the rounded centre, so any run whose pin lands in the same grid
// cell produces the identical area and reuses the cache: pressing Suggest
// again, or after a small pin nudge, doesn't trigger a fresh download. The
// fetch area's own margin (hundreds of metres) absorbs the rounding offset.
StreetIndex.prototype.snapPoint = function (
  this: Self,
  latlng: { lat: number; lng: number },
  g?: number,
) {
  g = g || 0.006;
  if (!host?.L) throw new ReferenceError("L is not defined");
  return host.L.latLng(Math.round(latlng.lat / g) * g, Math.round(latlng.lng / g) * g);
};

// Fetch streets for the tiles under the given rects (skipping ones already covered), nearest the
// centre of the rects first, in one call to the street source. A tile an earlier run is still asking
// for is waited for instead, and asked for in a second call only if that run gives it up.
// Each tile is read into the index as it arrives, so a failed run keeps what came and
// the next run asks only for the rest. opts.onProgress({done, total}) hears the start (done = the
// tiles already held, total = every tile under the rects; nothing when all are held) and every
// tile, and {done, total, waitUntil} when the source waits out a busy server (then {done, total}
// again once the wait ends); opts.deadlineMs (default RUN_DEADLINE_MS) stops the run
// before its next request once passed (every tile of a request already answered or still open is
// read), and refuses a wait that would end past it. opts.stale() true means a
// newer run replaced this one: it asks nothing further and rejects with cause reason
// "superseded". Rejects, with StreetIndex.downloadError, whenever a tile is missing: suggestions
// end in their error state rather than plan on part of the area. Anything else rejects as itself,
// not wrapped in a download error (a bug reading a tile, in the caller's onProgress or in sleep
// during a busy wait, or a source error with no street reason), so callers tell a bug from a
// "streets-partial" shortfall (StreetIndex.isDownloadError); of several bugs the first is the
// rejection, unless the source rejects with a bug of its own (see fetchSome's catch below). Resolves
// with {done, total}.
// Every piece under the rects counts as used, and none of them is evicted while the run is running;
// opts.holdAs (a caller's name) keeps them until that caller's next run, for a caller that plans on
// them once the run is over.
StreetIndex.prototype.ensureRects = function (this: Self, rects: Rect[], opts?: EnsureOptions) {
  let under: Set<string>;
  // a bad rect rejects rather than throwing at the call, so a .then caller hears of it
  try {
    under = new Set(StreetIndex.tilesOf(rects).map(StreetIndex.tileId));
  } catch (e) {
    return Promise.reject(e);
  }
  for (const pos of under) this._use(pos);
  if (opts && opts.holdAs) this.holds.set(opts.holdAs, under);
  this.runs.add(under);
  const run = this._ensureRects(rects, opts);
  // the caller's promise is the run itself, so this adds no step before the caller resumes
  const end = () => {
    this.runs.delete(under);
  };
  run.then(end, end);
  return run;
};

StreetIndex.prototype._ensureRects = async function (
  this: Self,
  rects: Rect[],
  opts?: EnsureOptions,
) {
  opts = opts || {};
  const todo = this._uncovered(rects);
  // total is every tile under the rects and the tiles already held count as done from the first
  // report, so a retry shows the same N as the run before it
  const total = StreetIndex.tilesOf(rects).length,
    held = total - todo.length;
  if (!todo.length) return { done: total, total };
  this._anchor((rects[0] as Rect).s);
  StreetIndex.nearestFirst(todo, rects);
  const deadlineMs = opts.deadlineMs == null ? RUN_DEADLINE_MS : opts.deadlineMs;
  const started = this.now();
  const tid = StreetIndex.tileId;
  const read = new Set(),
    want = new Set(todo.map(tid));
  // tiles read here that were not a fresh street-cache answer (onTile's {cached: true}): what
  // downloadError takes as `arrived`
  let downloaded = 0;
  let broke: unknown = null; // the first bug thrown by code this run drives (reading a tile, onProgress, sleep, stale() while waiting): what the run rejects with, unless the source has a bug of its own (see fetchSome's catch)
  const progress = (waitUntil?: number) => {
    if (!opts.onProgress) return;
    opts.onProgress(
      waitUntil === undefined
        ? { done: held + read.size, total }
        : { done: held + read.size, total, waitUntil },
    );
  };
  const stale = () => !!opts.stale && opts.stale();
  const superseded = () =>
    Object.assign(new Error("streets: a newer run replaced this one"), { reason: "superseded" });
  const deadlinePassed = () =>
    Object.assign(new Error("streets: run deadline passed"), { reason: "stalled" });
  const short = (cause: unknown) =>
    StreetIndex.downloadError(held + read.size, total, cause, downloaded);
  // the source's wait before asking again: false when it would end past the deadline
  const wait = async (until: number) => {
    if (stale()) throw superseded();
    if (until - started > deadlineMs) return false;
    // requests still open when the busy came can outlast the wait: no busy text for a wait
    // already over
    if (until <= this.now()) return true;
    // the caller's onProgress and the sleep are not the run's own stop: a throw from them is a bug, but
    // the run's own superseded throw below is not
    try {
      progress(until);
      // the wait ends early once the run goes stale (the sleep's own timer still runs out, doing nothing);
      // a throw from stale() is a bug like sleep's
      await new Promise<void>((resolve, reject) => {
        const end = (settle: (v?: any) => void) => (v?: any) => {
          stop();
          settle(v);
        };
        // biome-ignore lint/suspicious/useIterableCallbackReturn: `every` here is the run's injected timer, not Array.prototype.every
        const stop = this.every(() => {
          try {
            if (stale()) end(resolve)();
          } catch (e) {
            end(reject)(e);
          }
        }, STALE_POLL_MS);
        this.sleep(Math.max(0, until - this.now())).then(end(resolve), end(reject));
      });
      if (stale()) throw superseded();
      progress();
    } catch (e: any) {
      if (!broke && !(e && e.reason === "superseded")) broke = e;
      throw e;
    }
    return true;
  };
  // A tile a normal run asks for is in flight from then until it is read or the run's call to the
  // source ends, and a later run that needs it waits for it instead of asking again. A run
  // waits only for runs that started before it, so two runs never wait on each other.
  const claims = new Map(); // "x:y" -> this run's in-flight entry for it
  const claim = (tiles: Tile[]) => {
    for (const t of tiles) {
      const entry = { key: tid(t) } as Claim;
      entry.promise = new Promise((resolve) => {
        entry.done = resolve;
      });
      claims.set(tid(t), entry);
      this.inFlight.set(entry.key, entry);
    }
  };
  // via: what the source said of the tile it read ({cached: true} from the street cache), or
  // nothing when the run gave the tile up
  const unclaim = (id: string, via?: { cached?: boolean }) => {
    const entry = claims.get(id);
    if (!entry) return;
    claims.delete(id);
    if (this.inFlight.get(entry.key) === entry) this.inFlight.delete(entry.key);
    entry.done(via);
  };
  const take = (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => {
    const id = tid(t);
    // a street block's tile that came in its box unasked: read and covered unless already held, so a later
    // run need not ask for it, but not counted in this run's progress
    if (answer && !want.has(id) && !this.tiles.has(id)) {
      this._read(answer, { x: t.x, y: t.y });
      this._cover([t]);
    }
    if (!answer || !want.has(id) || read.has(id)) return;
    this._read(answer, { x: t.x, y: t.y });
    this._cover([t]);
    read.add(id);
    if (!(via && via.cached)) downloaded++;
    unclaim(id, via || {});
    progress();
  };
  const ownStops = new Set(); // the deadline errors this run threw from onTile, which a source hands back as its failure
  const onTile = (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => {
    try {
      take(t, answer, via);
    } catch (e) {
      if (!broke) broke = e;
      throw e;
    }
    if (read.size === todo.length) return;
    if (stale()) throw superseded();
    if (this.now() - started >= deadlineMs) {
      const e = deadlinePassed();
      ownStops.add(e);
      throw e;
    }
  };
  // One call to the street source; its tiles are in flight for this run until it ends.
  const fetchSome = async (tiles: Tile[]) => {
    claim(tiles);
    try {
      let answers: Map<string, TileAnswer | undefined> | undefined;
      try {
        if (stale()) throw superseded();
        answers = await this.fetchStreets(tiles, onTile, { now: this.now, wait, stale });
      } catch (e: any) {
        // a source's own bug is thrown ahead of the run's (see the docstring); `broke` covers a run
        // bug the source rejects as a download error
        if (!StreetIndex.isDownloadError(e) && !STREET_REASONS.has(e && e.reason)) throw e;
        if (broke) throw broke;
        // a bug wrapped in a download error is thrown as itself, whether or not every tile arrived
        if (StreetIndex.isDownloadError(e) && e.cause && !STREET_REASONS.has(e.cause.reason))
          throw e.cause;
        // a deadline raised on an earlier answer while the open requests landed the rest loses
        // nothing: the call is whole. A replaced run still rejects, so its caller does no more work.
        // the source keeps its first stop, so a replacement that came after a failure is told here
        if (tiles.some((t) => !read.has(tid(t))) || (e && e.reason === "superseded"))
          throw short(stale() ? superseded() : e);
        // nothing this call asked for is missing, so its failure is not the run's to show, but a source that
        // fails after handing every tile is worth seeing; not for a replaced run (never logged). The class
        // and the street reason (download errors are all Error) only, as a message can name a tile
        if (!ownStops.has(e) && !stale())
          console.warn(
            "[streets] a street source failed after every piece it was asked for arrived",
            e && e.name,
            e && e.reason,
          );
      }
      // a source that swallowed the caller's throw and resolved anyway still hands the bug on
      if (broke) throw broke;
      // a source may hand tiles over in its Map alone
      for (const t of tiles) take(t, answers && answers.get(tid(t)));
    } finally {
      for (const t of tiles) unclaim(tid(t));
    }
  };

  // the tiles another run is already bringing; the rest this run asks for itself
  const split = (tiles: Tile[]) => {
    const shared: Array<{ t: Tile; entry: Claim }> = [],
      ask: Tile[] = [];
    for (const t of tiles) {
      const entry = this.inFlight.get(tid(t));
      if (entry) shared.push({ t, entry });
      else ask.push(t);
    }
    return { shared, ask };
  };
  let settled = false;
  // Settles once every shared tile is read or given up by the run bringing it. Rejects superseded,
  // or with the deadline, when a shared tile lands or at a check every STALE_POLL_MS, leaving the other
  // run's request alone: the run bringing the tile may take minutes, or never deliver.
  const waitFor = (shared: Array<{ t: Tile; entry: Claim }>) =>
    new Promise<void>((resolveWait, rejectWait) => {
      let left = shared.length;
      const resolve = () => {
        stop();
        resolveWait();
      };
      const reject = (e: unknown) => {
        stop();
        rejectWait(e);
      };
      // biome-ignore lint/suspicious/useIterableCallbackReturn: `every` here is the run's injected timer, not Array.prototype.every
      const stop = this.every(() => {
        if (settled) return stop();
        try {
          if (stale()) reject(short(superseded()));
          else if (this.now() - started >= deadlineMs) reject(short(deadlinePassed()));
        } catch (e) {
          if (!broke) broke = e;
          reject(e);
        }
      }, STALE_POLL_MS);
      for (const { t, entry } of shared)
        entry.promise.then((via: any) => {
          if (settled) return;
          const id = tid(t);
          // a throw here (onProgress, the caller's stale) is a bug: the wait rejects with it rather than never settling
          try {
            // covered: the other run read it; else it gave the tile up, and this run asks for it again
            if (!read.has(id) && holds(this.tiles, t)) {
              read.add(id);
              if (via && !via.cached) downloaded++;
              progress();
            }
            if (stale()) reject(short(superseded()));
            else if (!--left) resolve();
          } catch (e) {
            if (!broke) broke = e;
            reject(e);
          }
        });
    });
  progress();
  try {
    let { shared, ask } = split(todo);
    for (;;) {
      // started before this run's own call, which can outlast every shared tile
      const sharedIn = shared.length ? waitFor(shared) : null;
      if (sharedIn) sharedIn.catch(() => {}); // awaited only after this run's own call, so a rejection before then is not reported as unhandled
      if (ask.length) await fetchSome(ask);
      if (!sharedIn) break;
      // a bug beside the wait's superseded rejection is still the run's rejection
      try {
        await sharedIn;
      } catch (e) {
        throw broke || e;
      }
      if (broke) throw broke;
      // what the other run gave up on (it failed, or was replaced, before reading it); split again,
      // so of several runs waiting for it one asks and the rest wait for that one
      const left = shared.map((x) => x.t).filter((t) => !read.has(tid(t)));
      if (!left.length) break;
      if (stale()) throw short(superseded());
      if (this.now() - started >= deadlineMs) throw short(deadlinePassed());
      // a run that waited beside this one may have asked and read it already; not counted as
      // downloaded, as this run cannot tell whether the street cache answered that run
      for (const t of left)
        if (holds(this.tiles, t)) {
          read.add(tid(t));
          progress();
        }
      ({ shared, ask } = split(left.filter((t) => !read.has(tid(t)))));
      if (!shared.length && !ask.length) break;
    }
  } finally {
    settled = true;
  }
  if (broke) throw broke;
  // replaced while its last request was open (onTile stops checking once every tile is read): it
  // still rejects, so its caller does no more work
  if (stale()) throw short(superseded());
  const lost = todo.find((t) => !read.has(tid(t)));
  // the source answered but left a tile out: a server's fault, not the network's, worded generically
  if (lost)
    throw short(
      Object.assign(new Error(`street source: no answer for tile ${lost.x}:${lost.y}`), {
        reason: "server",
      }),
    );
  return { done: total, total };
};

// One tile's answer ({x, y}) into the index; the version bump tells graphs built before it to rebuild.
// A way is held while any tile brings it, and splitAnswer hands a whole way to every tile it touches,
// so a way across two tiles is added once and listed by both.
StreetIndex.prototype._read = function (this: Self, answer: TileAnswer, from: Tile) {
  // without its tile a read could not say which piece holds what it brings
  if (!from) throw new TypeError("streets: _read needs the tile it reads");
  const pos = StreetIndex.tileId(from);
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
StreetIndex.prototype.newAreaM2 = function (
  this: Self,
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
StreetIndex.prototype._syncFog = function (this: Self) {
  const fog = this.fogVersion();
  if (fog === this.fracFog) return;
  this.fracFog = fog;
  for (const cell of this.segs.values()) for (const s of cell) s.frac = null;
};

StreetIndex.TILE_DEG = TILE_DEG;
StreetIndex.tileOf = (lng: number, lat: number) => ({
  x: Math.floor(lng / TILE_DEG),
  y: Math.floor(lat / TILE_DEG),
});
// A bound on a tile edge takes the tile on its inside (a west or south edge the tile it opens, an
// east or north edge the tile it closes), so a tile's own bounds map back to it; a rect with
// no width still takes one tile.
StreetIndex.tilesCovering = ({ s, w, n, e }: Rect) => {
  const x0 = Math.floor(w / TILE_DEG + TILE_EPS),
    y0 = Math.floor(s / TILE_DEG + TILE_EPS);
  const x1 = Math.max(x0, Math.ceil(e / TILE_DEG - TILE_EPS) - 1),
    y1 = Math.max(y0, Math.ceil(n / TILE_DEG - TILE_EPS) - 1);
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles;
};
// Every tile under the rects, each once.
StreetIndex.tilesOf = (rects: Rect[]) => {
  const seen = new Set();
  return rects
    .flatMap((r) => StreetIndex.tilesCovering(r))
    .filter((t) => {
      const k = StreetIndex.tileId(t);
      return !seen.has(k) && seen.add(k);
    });
};
StreetIndex.tileBounds = ({ x, y }: Tile) => ({
  s: y * TILE_DEG,
  w: x * TILE_DEG,
  n: (y + 1) * TILE_DEG,
  e: (x + 1) * TILE_DEG,
});
// "x:y", the key of a piece in every Map and Set keyed by tile
StreetIndex.tileId = (t: Tile) => t.x + ":" + t.y;

// The Overpass query for the given boxes ([{s,w,n,e}]). The bench cache is keyed on this
// text, with its [timeout:25] read as [timeout:60] (bench/lib/fetch-cache.js), so any edit
// but a return to [timeout:60] makes every saved rectQuery answer miss. [timeout:25]
// caps the server's run once the query leaves its queue. overpass-api.de sends nothing until the
// run ends, so the client guard that binds is FIRST_BYTE_MS in overpass.ts, whose comment holds the
// queue measurement: a queue plus a 25 s run can still overrun it, and that request counts as a stall.
StreetIndex.rectQuery = (boxes: Rect[]) => {
  const bb = (r: Rect) => [r.s, r.w, r.n, r.e].map((x) => x.toFixed(4)).join(",");
  // access filter: planned and routed trips must not cross ways the person can't
  // use (motorroads are for motor vehicles)
  const acc = `[access!~"^(private|no|military)$"][motorroad!=yes][foot!=no]`;
  const clauses = (hw: string) =>
    boxes
      .map(
        (r) =>
          `way[highway~"^(${hw})$"]${acc}(${bb(r)});way[highway=service]${acc}[service!~"^(driveway|parking_aisle)$"](${bb(r)});`,
      )
      .join("");
  const hw = RUN_HW;
  // the box is scanned once into .all, which the geometry and the closing count both read: scanning the
  // box again for each output ran Overpass out of time on a town-sized box
  // the count that closes the answer: splitAnswer takes a response without it for one that was cut
  return `[out:json][timeout:25];(${clauses(hw)})->.all;.all out skel geom;.all out count;`;
};

// A request asks for at most one street block, a 2x2 group of tiles starting at even tile indices
// (not Fog of World's bitmap block). overpass-api.de queues even a one-tile request for tens of
// seconds (measurements in overpass.ts, #185), so requests open at once (Overpass.cap()) share that
// wait where requests in a row add it up, and a failure loses only its street block. Splits tiles (nearest
// first) by street block, street blocks in the order of their nearest tile.
function batches(tiles: Tile[]) {
  const blocks = new Map();
  for (const t of tiles) {
    const b = Math.floor(t.x / 2) + ":" + Math.floor(t.y / 2);
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(t);
  }
  return [...blocks.values()];
}

// The tiles a street block's request brings: its missing tiles when they fill a rectangle (the street
// block, a strip of two, one tile), so nothing already held is asked again; else the whole street
// block, since one box over a ragged set covers it anyway. The missing tiles come first, since a way that
// lands in no tile goes to the first.
function batchTiles(batch: Tile[]) {
  const xs = batch.map((t) => t.x),
    ys = batch.map((t) => t.y);
  if (
    (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) ===
    batch.length
  )
    return batch;
  const x0 = Math.floor((xs[0] as number) / 2) * 2,
    y0 = Math.floor((ys[0] as number) / 2) * 2;
  const block = (
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as Array<[number, number]>
  ).map(([dx, dy]) => ({ x: x0 + dx, y: y0 + dy }));
  return batch.concat(block.filter((t) => !batch.some((b) => b.x === t.x && b.y === t.y)));
}

// One box over the tiles a request brings (batchTiles), so the query has one area clause per highway list.
function batchBoxes(tiles: Tile[]) {
  const xs = tiles.map((t) => t.x),
    ys = tiles.map((t) => t.y);
  return [
    {
      s: Math.min(...ys) * TILE_DEG,
      w: Math.min(...xs) * TILE_DEG,
      n: (Math.max(...ys) + 1) * TILE_DEG,
      e: (Math.max(...xs) + 1) * TILE_DEG,
    },
  ];
}

// The default street source: one Overpass request per street block (batches above), up to
// Overpass.cap() of them open at once, each answer split per tile into onTile as it lands, including
// the street block's unasked tiles when a ragged set asks the whole street block (they come in the
// box anyway, and the street cache keeps them). A busy answer puts its street block back in the queue
// and sets a wait of BUSY_RETRY_MS (or its retryAt when later); busy answers while a wait is set are
// the same step. Nothing new is sent until the wait ends, and the requests already open carry on. The
// wait goes through opts.wait(until) -> false to give up (default: sleep until then on opts.now,
// default Date.now) only once none is open, so the page shows the busy text only while nothing is
// coming. An answer that lands while no wait is set starts the count again; one that lands beside a
// busy answer, with a wait already set, does not. A busy answer after the last step ends the run only
// once the requests open with it have finished and none was answered; if one was, the server has
// recovered and that busy is the first step of a new count, so the outcome does not depend on which
// answer lands first. opts.stale goes to Overpass.post, so a replaced run's posts still waiting for
// a slot are not sent (they fail "superseded"). Any other failure carrying a street reason, a busy
// answer ending the count, a refused wait, or a throw from onTile or opts.wait (the caller's stop, or
// a bug), or any error with none of STREET_REASONS (a bug building a request or reading an answer):
// nothing new is sent, the open requests finish and hand their tiles over, then the run rejects with
// the failure that stopped it (for a refused wait or an ended count, the last busy answer); the throws
// that are not a download failure pass through unchanged.
StreetIndex.overpassFetch = (
  tiles: Tile[],
  onTile?: (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => void,
  opts?: RunOptions,
): Promise<Map<string, TileAnswer | undefined>> => {
  opts = opts || {};
  const out = new Map<string, TileAnswer | undefined>();
  const now = opts.now || Date.now;
  const wait =
    opts.wait ||
    ((until: number) =>
      new Promise((resolve) => setTimeout(() => resolve(true), Math.max(0, until - now()))));
  const queue = batches(tiles).map((batch, rank) => ({ batch, rank }));
  const got = () => tiles.filter((t) => out.has(StreetIndex.tileId(t))).length;
  return new Promise<Map<string, TileAnswer | undefined>>((resolve, reject) => {
    // last: the wait set is the step past the schedule, ending the run unless recovered (a request
    // was answered while it was set) by the time the requests open with it have finished
    let open = 0,
      busy = 0,
      until = 0,
      lastBusy: StreetError | null = null,
      waiting = false,
      stop: { e: any; passThrough: boolean } | null = null,
      last = false,
      recovered = false;
    // an error without a street reason is a bug and passes through unchanged, like the caller's own throws
    const fail = (e: any, passThrough?: boolean) => {
      if (!stop) stop = { e, passThrough: passThrough || !STREET_REASONS.has(e && e.reason) };
    };
    const pump = () => {
      if (stop) {
        if (!open)
          reject(
            stop.passThrough ? stop.e : StreetIndex.downloadError(got(), tiles.length, stop.e),
          );
        return;
      }
      if (until) {
        if (open || waiting) return;
        if (last) {
          last = false;
          if (!recovered) {
            fail(lastBusy, false);
            return pump();
          }
          busy = 1;
        }
        waiting = true;
        Promise.resolve(until)
          .then(wait)
          .then(
            (go) => {
              waiting = false;
              until = 0;
              if (!go) fail(lastBusy, false);
              pump();
            },
            (e) => {
              waiting = false;
              until = 0;
              fail(e, true);
              pump();
            },
          );
        return;
      }
      // a throw here (building a request, reading the cap) is a bug and may come from an answer's
      // handler, where nothing would catch it and the run would never settle
      try {
        while (!stop && queue.length && open < (Overpass.cap() as number))
          send(queue.shift() as { batch: Tile[]; rank: number });
      } catch (e) {
        fail(e, true);
      }
      if (stop) return pump();
      if (!open) resolve(out);
    };
    const send = (item: { batch: Tile[]; rank: number }) => {
      const ask = batchTiles(item.batch);
      // the query is built and the request started before open++, so a throw from either never
      // leaves a counted request that no answer closes
      const request = Overpass.post(
        "data=" + encodeURIComponent(StreetIndex.rectQuery(batchBoxes(ask))),
        { stale: opts.stale },
      );
      open++;
      // a throw from a handler (a bug) must still end the run: nothing else catches it
      const guard = (handler: (v: any) => void) => (v: any) => {
        try {
          handler(v);
        } catch (e) {
          fail(e, true);
          pump();
        }
      };
      request.then(
        guard((json) => {
          open--;
          // an answer with no wait set restarts the count; one that lands while the final wait is set
          // (open beside that busy) shows the server recovered, so the run waits again instead of ending
          if (!until) busy = 0;
          else if (last) recovered = true;
          let answers: Map<string, TileAnswer>;
          try {
            answers = StreetIndex.splitAnswer(json, ask);
          } catch (e) {
            fail(e, false);
            return pump();
          }
          // the whole answer is in: every tile of it is handed over, whatever the caller throws
          for (const t of ask) {
            const id = StreetIndex.tileId(t),
              answer = answers.get(id);
            out.set(id, answer);
            try {
              if (onTile) onTile(t, answer);
            } catch (e) {
              fail(e, true);
            }
          }
          pump();
        }),
        guard((e: any) => {
          open--;
          if (!e || e.reason !== "busy") fail(e, false);
          else if (!stop) {
            lastBusy = e;
            queue.push(item);
            queue.sort((a, b) => a.rank - b.rank);
            if (until) until = Math.max(until, e.retryAt || 0);
            else if (busy === BUSY_RETRY_MS.length) {
              last = true;
              recovered = false;
              until = Math.max(now() + (BUSY_RETRY_MS[0] as number), e.retryAt || 0);
            } else until = Math.max(now() + (BUSY_RETRY_MS[busy++] as number), e.retryAt || 0);
          }
          pump();
        }),
      );
    };
    pump();
  });
};

// The error a street source or ensureRects rejects with when a tile is missing: how many of the
// tiles are in (done of total), the failure that stopped the run as `cause`, its
// retryAt, and reason "streets-partial" once any tile was downloaded (else the cause's own reason).
// `arrived` is how many this run downloaded and defaults to done: ensureRects counts neither the
// tiles the index already held nor fresh street-cache answers (onTile's {cached: true}), so an
// offline run in a partly cached area still says offline.
// A cause that is itself such an error is unwrapped, so `cause` is always the first failure.
StreetIndex.downloadError = (done: number, total: number, cause: any, arrived?: number) => {
  const first = cause && typeof cause.total === "number" && cause.cause ? cause.cause : cause;
  const err = new Error(
    `streets: got ${done} of ${total} tiles` + (first && first.message ? ": " + first.message : ""),
  ) as StreetError;
  err.done = done;
  err.total = total;
  err.cause = first;
  err.reason =
    (arrived === undefined ? done : arrived) > 0 ? "streets-partial" : first && first.reason;
  if (first && first.retryAt) err.retryAt = first.retryAt;
  return err;
};

// Whether a street download fell short (a downloadError), rather than a bug ensureRects rethrows
// as itself: only the first is worded as a download failure.
StreetIndex.isDownloadError = (e: any) =>
  !!e && typeof e.total === "number" && typeof e.done === "number";

// Whether a run ended because a newer one replaced it (opts.stale): nothing went wrong, so a caller
// neither shows nor logs it. A bug thrown while a run is stale is still logged by its class; a
// download failure while stale is simply not shown.
StreetIndex.isSuperseded = (e: any) =>
  StreetIndex.isDownloadError(e) && !!e.cause && e.cause.reason === "superseded";

// What a caller may pass on from a failed download, for StreetMessages to word: the reasons, counts and
// retry time, never the message, which can hold a server remark or a tile number.
StreetIndex.downloadFacts = (e: any) => ({
  reason: e && e.reason,
  done: e && e.done,
  total: e && e.total,
  retryAt: e && e.retryAt,
  cause: e && e.cause ? { reason: e.cause.reason } : undefined,
});

// Sorts tiles in place by distance from the centre of the rects' bounding box, longitude scaled to
// ground distance at that latitude; equal distances keep their order.
StreetIndex.nearestFirst = (tiles: Tile[], rects: Rect[]) => {
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

// Whether the segment a-b touches the box (Liang-Barsky; the edges count).
function segmentTouches(a: Vertex, b: Vertex, r: Rect) {
  const dx = b.lon - a.lon,
    dy = b.lat - a.lat;
  let t0 = 0,
    t1 = 1;
  for (const [p, q] of [
    [-dx, a.lon - r.w],
    [dx, r.e - a.lon],
    [-dy, a.lat - r.s],
    [dy, r.n - a.lat],
  ] as Array<[number, number]>) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

// Reads an Overpass answer to a rectQuery and hands each requested tile its share. An answer that is
// not the whole of one (not an object, a remark, no elements, no count marker
// rectQuery ends the geometry with) throws with reason "server" and a fixed message: server text never
// reaches a message.
StreetIndex.splitAnswer = (gj: any, tiles: Tile[]) => {
  const unusable = (what: string) =>
    Object.assign(new Error("overpass: " + what), { reason: "server" });
  if (!gj || typeof gj !== "object") throw unusable("the answer is not an object");
  // a timeout or out-of-memory still answers 200, with whatever it had by then
  if (gj.remark) throw unusable("the server remarked on the answer");
  if (!Array.isArray(gj.elements)) throw unusable("the answer has no elements");
  const ways = [];
  let closed = false; // the count after the geometry has been read
  for (const el of gj.elements) {
    if (!el) continue;
    if (el.type === "count") {
      closed = true;
      continue;
    }
    if (el.type !== "way" || closed) continue;
    ways.push({ id: el.id, nodes: el.nodes, geometry: el.geometry });
  }
  // a cut answer would store its tiles as covered with only some of their ways
  if (!closed) throw unusable("the answer is incomplete");
  // a way goes to every requested tile one of its segments touches (a long segment can cross a tile
  // with no vertex in it), to the first when none does
  const answers = new Map<string, TileAnswer>(
    tiles.map((t) => [StreetIndex.tileId(t), { ways: [], groups: {} }]),
  );
  const boxes = tiles.map(
    (t) => [answers.get(StreetIndex.tileId(t)), StreetIndex.tileBounds(t)] as [TileAnswer, Rect],
  );
  for (const w of ways) {
    const hit = new Set<TileAnswer>(),
      g = w.geometry || [];
    // a null or non-finite vertex would cut the way short or (NaN) match every tile: the way is
    // left out, and the rest of the answer stays usable
    if (
      !Array.isArray(g) ||
      g.some((v) => !v || !Number.isFinite(v.lat) || !Number.isFinite(v.lon))
    )
      continue;
    for (let i = 0; i < Math.max(1, g.length - 1); i++) {
      const a = g[i],
        b = g[i + 1] || a;
      if (!a) break;
      for (const [answer, box] of boxes)
        if (!hit.has(answer) && segmentTouches(a, b, box)) hit.add(answer);
    }
    const into = hit.size
      ? [...hit]
      : [answers.get(StreetIndex.tileId(tiles[0] as Tile)) as TileAnswer];
    for (const a of into) a.ways.push(w);
  }
  return answers;
};

// The constructor itself, not a copy: other files build it with `new` and call its statics (`overpassFetch`,
// `downloadError`, `isSuperseded`, `tileId`...), and the tests read its fields.
export { StreetIndex };
