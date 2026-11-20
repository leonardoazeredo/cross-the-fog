// How street tiles arrive: the Overpass street source, the query and the answer split, the in-flight
// registry that lets runs share a tile, the busy schedule, the run deadline, and the errors a failed
// download carries. What is kept is streetStore.ts: this reaches it only through StreetSeam.
import { Overpass } from "./overpass.ts";
import {
  nearestFirst,
  type Rect,
  TILE_DEG,
  type Tile,
  type TileAnswer,
  tileBounds,
  tileId,
  tilesOf,
  type Vertex,
} from "./streetGrid.ts";

export interface StreetError extends Error {
  reason?: string;
  retryAt?: number;
  done?: number;
  total?: number;
  cause?: StreetError;
}
export interface RunOptions {
  now?: () => number;
  wait?: (until: number) => Promise<boolean>;
  stale?: () => boolean;
}
export type Source = (
  tiles: Tile[],
  onTile: (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => void,
  opts?: RunOptions,
) => Promise<Map<string, TileAnswer | undefined>>;
export interface EnsureOptions {
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
// What the download needs of the street store, and all it touches of it.
export interface StreetSeam {
  // whether the tile is held
  holds(t: Tile): boolean;
  // the metre frame the store's segments are scored in, anchored on the first fetch
  anchor(lat: number): void;
  // one tile's answer into the store; the store's version moves
  read(answer: TileAnswer, from: Tile): void;
  // the tiles count as held from now on
  cover(tiles: Tile[]): void;
  // the pieces under a run's rects are in use and not evicted until the returned release is called,
  // or, for a named caller, until that caller's next run
  protect(under: Set<string>, holdAs?: string): () => void;
}
// What a run reads off the index that owns it, each time it runs: the street source, the clock, the
// sleep and the timer a waiting run checks stale() on.
export interface RunSettings {
  fetchStreets: Source;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  every: (fn: () => void, ms: number) => () => void;
}
export interface StreetDownload {
  ensureRects(rects: Rect[], opts?: EnsureOptions): Promise<{ done: number; total: number }>;
  // whether no tile is in flight: every run's claims are given back when it ends
  idle(): boolean;
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

// The Overpass query for the given boxes ([{s,w,n,e}]). The bench cache is keyed on this
// text, with its [timeout:25] read as [timeout:60] (bench/lib/fetch-cache.js), so any edit
// but a return to [timeout:60] makes every saved rectQuery answer miss. [timeout:25]
// caps the server's run once the query leaves its queue. overpass-api.de sends nothing until the
// run ends, so the client guard that binds is FIRST_BYTE_MS in overpass.ts, whose comment holds the
// queue measurement: a queue plus a 25 s run can still overrun it, and that request counts as a stall.
export const rectQuery = (boxes: Rect[]) => {
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
export const overpassFetch = (
  tiles: Tile[],
  onTile:
    | ((t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => void)
    | undefined,
  opts: RunOptions | undefined,
  // the query and the answer split are the constructor's own statics, looked up when a request is built or
  // answered: callers replace them there
  statics: {
    rectQuery: (boxes: Rect[]) => string;
    splitAnswer: (gj: unknown, tiles: Tile[]) => Map<string, TileAnswer>;
  },
): Promise<Map<string, TileAnswer | undefined>> => {
  opts = opts || {};
  const out = new Map<string, TileAnswer | undefined>();
  const now = opts.now || Date.now;
  const wait =
    opts.wait ||
    ((until: number) =>
      new Promise((resolve) => setTimeout(() => resolve(true), Math.max(0, until - now()))));
  const queue = batches(tiles).map((batch, rank) => ({ batch, rank }));
  const got = () => tiles.filter((t) => out.has(tileId(t))).length;
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
        if (!open) reject(stop.passThrough ? stop.e : downloadError(got(), tiles.length, stop.e));
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
        "data=" + encodeURIComponent(statics.rectQuery(batchBoxes(ask))),
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
            answers = statics.splitAnswer(json, ask);
          } catch (e) {
            fail(e, false);
            return pump();
          }
          // the whole answer is in: every tile of it is handed over, whatever the caller throws
          for (const t of ask) {
            const id = tileId(t),
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
export const downloadError = (done: number, total: number, cause: any, arrived?: number) => {
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
export const isDownloadError = (e: any) =>
  !!e && typeof e.total === "number" && typeof e.done === "number";

// Whether a run ended because a newer one replaced it (opts.stale): nothing went wrong, so a caller
// neither shows nor logs it. A bug thrown while a run is stale is still logged by its class; a
// download failure while stale is simply not shown.
export const isSuperseded = (e: any) =>
  isDownloadError(e) && !!e.cause && e.cause.reason === "superseded";

// What a caller may pass on from a failed download, for StreetMessages to word: the reasons, counts and
// retry time, never the message, which can hold a server remark or a tile number.
export const downloadFacts = (e: any) => ({
  reason: e && e.reason,
  done: e && e.done,
  total: e && e.total,
  retryAt: e && e.retryAt,
  cause: e && e.cause ? { reason: e.cause.reason } : undefined,
});

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
export const splitAnswer = (gj: any, tiles: Tile[]) => {
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
    tiles.map((t) => [tileId(t), { ways: [], groups: {} }]),
  );
  const boxes = tiles.map((t) => [answers.get(tileId(t)), tileBounds(t)] as [TileAnswer, Rect]);
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
    const into = hit.size ? [...hit] : [answers.get(tileId(tiles[0] as Tile)) as TileAnswer];
    for (const a of into) a.ways.push(w);
  }
  return answers;
};

export function createDownload(settings: RunSettings, store: StreetSeam): StreetDownload {
  // tileId -> {key, promise, done}: a tile a running ensureRects is asking for, which a later run waits for
  const inFlight = new Map<string, Claim>();
  const d: Run = { settings, store, inFlight };
  return {
    ensureRects: (rects, opts) => ensureRects(d, rects, opts),
    idle: () => inFlight.size === 0,
  };
}

interface Run {
  settings: RunSettings;
  store: StreetSeam;
  inFlight: Map<string, Claim>;
}

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
function ensureRects(d: Run, rects: Rect[], opts?: EnsureOptions) {
  let under: Set<string>;
  // a bad rect rejects rather than throwing at the call, so a .then caller hears of it
  try {
    under = new Set(tilesOf(rects).map(tileId));
  } catch (e) {
    return Promise.reject(e);
  }
  const end = d.store.protect(under, opts && opts.holdAs);
  const run = runRects(d, rects, opts);
  // the caller's promise is the run itself, so this adds no step before the caller resumes
  run.then(end, end);
  return run;
}

async function runRects(d: Run, rects: Rect[], opts?: EnsureOptions) {
  const { settings, store, inFlight } = d;
  opts = opts || {};
  const todo = tilesOf(rects).filter((t) => !store.holds(t));
  // total is every tile under the rects and the tiles already held count as done from the first
  // report, so a retry shows the same N as the run before it
  const total = tilesOf(rects).length,
    held = total - todo.length;
  if (!todo.length) return { done: total, total };
  store.anchor((rects[0] as Rect).s);
  nearestFirst(todo, rects);
  const deadlineMs = opts.deadlineMs == null ? RUN_DEADLINE_MS : opts.deadlineMs;
  const started = settings.now();
  const tid = tileId;
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
  const short = (cause: unknown) => downloadError(held + read.size, total, cause, downloaded);
  // the source's wait before asking again: false when it would end past the deadline
  const wait = async (until: number) => {
    if (stale()) throw superseded();
    if (until - started > deadlineMs) return false;
    // requests still open when the busy came can outlast the wait: no busy text for a wait
    // already over
    if (until <= settings.now()) return true;
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
        const stop = settings.every(() => {
          try {
            if (stale()) end(resolve)();
          } catch (e) {
            end(reject)(e);
          }
        }, STALE_POLL_MS);
        settings.sleep(Math.max(0, until - settings.now())).then(end(resolve), end(reject));
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
      inFlight.set(entry.key, entry);
    }
  };
  // via: what the source said of the tile it read ({cached: true} from the street cache), or
  // nothing when the run gave the tile up
  const unclaim = (id: string, via?: { cached?: boolean }) => {
    const entry = claims.get(id);
    if (!entry) return;
    claims.delete(id);
    if (inFlight.get(entry.key) === entry) inFlight.delete(entry.key);
    entry.done(via);
  };
  const take = (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => {
    const id = tid(t);
    // a street block's tile that came in its box unasked: read and covered unless already held, so a later
    // run need not ask for it, but not counted in this run's progress
    if (answer && !want.has(id) && !store.holds(t)) {
      store.read(answer, { x: t.x, y: t.y });
      store.cover([t]);
    }
    if (!answer || !want.has(id) || read.has(id)) return;
    store.read(answer, { x: t.x, y: t.y });
    store.cover([t]);
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
    if (settings.now() - started >= deadlineMs) {
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
        answers = await settings.fetchStreets(tiles, onTile, { now: settings.now, wait, stale });
      } catch (e: any) {
        // a source's own bug is thrown ahead of the run's (see the docstring); `broke` covers a run
        // bug the source rejects as a download error
        if (!isDownloadError(e) && !STREET_REASONS.has(e && e.reason)) throw e;
        if (broke) throw broke;
        // a bug wrapped in a download error is thrown as itself, whether or not every tile arrived
        if (isDownloadError(e) && e.cause && !STREET_REASONS.has(e.cause.reason)) throw e.cause;
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
      const entry = inFlight.get(tid(t));
      if (entry) shared.push({ t, entry });
      else ask.push(t);
    }
    return { shared, ask };
  };
  let settled = false;
  // Settles once every shared tile is read or given up by the run bringing it. Rejects superseded
  // when a shared tile lands or at a check every STALE_POLL_MS, and with the deadline at that check, leaving the other
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
      const stop = settings.every(() => {
        if (settled) return stop();
        try {
          if (stale()) reject(short(superseded()));
          else if (settings.now() - started >= deadlineMs) reject(short(deadlinePassed()));
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
            if (!read.has(id) && store.holds(t)) {
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
      if (settings.now() - started >= deadlineMs) throw short(deadlinePassed());
      // a run that waited beside this one may have asked and read it already; not counted as
      // downloaded, as this run cannot tell whether the street cache answered that run
      for (const t of left)
        if (store.holds(t)) {
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
}
