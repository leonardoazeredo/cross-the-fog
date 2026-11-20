// Cache-first street source: wraps a network street source (StreetIndex.overpassFetch) with a
// TileStore of per-tile answers, so a loop planned once in an area plans again with no
// connection. Overpass only ever sees the bounding boxes of tiles not held here.
import type { TileStoreApi } from "./tileStore.ts";

const DAY_MS = 24 * 3600 * 1000;

// a tile of StreetIndex's grid, and what the street source hands for it (the cache reads only the top level)
export interface Tile {
  x: number;
  y: number;
}
export interface StreetAnswer {
  ways: unknown[];
  groups: Record<string, unknown>;
}
type Stored = { answer: StreetAnswer; fetchedAt: number };
// the run's options, passed to the network source as they are
export interface RunOptions {
  wait?: (until: number) => Promise<boolean | undefined> | boolean | undefined;
  stale?: () => boolean;
  [name: string]: unknown;
}
type OnTile = (t: Tile, answer: StreetAnswer, via?: { cached: true }) => void;
export type StreetSource = (
  tiles: Tile[],
  onTile?: OnTile,
  opts?: RunOptions,
) => Promise<Map<string, StreetAnswer>>;

export interface CreateOptions {
  store: TileStoreApi;
  network: StreetSource;
  now: () => number;
  maxAgeMs?: number | null;
}

// Own key format, not StreetIndex.tileId, so persisted keys do not follow changes to the
// in-memory one. The leading version is the tile grid's: bump it whenever TILE_DEG in streets.js
// changes, or answers fetched for the old grid are read as tiles of the new one.
// The same prefix is the schema version of a stored entry: change the answer format and the prefix
// together, and old entries are never read (sweepLegacy leaves them; they go only when LRU eviction reaches them, once the store is full).
// what one fetchStreets call counts about the store, see settle
interface CallState {
  storeDown: boolean;
  touched: boolean;
  failed: boolean;
  puts: Promise<unknown>[];
}

const KEY_VERSION = "4:";
const idOf = (t: Tile) => t.x + ":" + t.y;
// "run" names the on-foot answer, the only one asked for now; it stays in the key so a phone's
// cache keeps serving. Entries under the removed "bike" kind are never read and go by LRU eviction.
const keyOf = (t: Tile) => KEY_VERSION + "run:" + idOf(t);
// old keys removed per open: the sweep must not hold up a store that still has hundreds
const LEGACY_SWEEP_MAX = 256;
// what a failed download carries (Overpass.post's reasons, and the default source's "streets-partial"
// when some tiles arrived first): only these stand for an outage; any other throw is a bug and
// must not be answered with old streets. Kept here, not read from streets.js, which loads after.
const OUTAGE_REASONS = new Set([
  "busy",
  "blocked",
  "stalled",
  "offline",
  "server",
  "streets-partial",
]);

export function create(opts: CreateOptions) {
  const { store, network, now } = opts;
  const maxAgeMs = opts.maxAgeMs == null ? 90 * DAY_MS : opts.maxAgeMs;
  let warned = false; // a full or broken store fails every call: one line says so
  // A hung IndexedDB costs up to the store's own timeout on every call, so after this many calls in a
  // row that met a store failure the store is left alone for the session (not swapped for a memory one:
  // StreetIndex already keeps the session's tiles). A call counts once however many of its operations
  // failed. The backend counts like any other: a memory fallback does not fail, so nothing needs a case.
  const SKIP_AFTER = 3;
  let failedCalls = 0,
    skipStore = false;
  const storeFailed = (state: CallState, what: string, e: unknown) => {
    state.storeDown = state.failed = true;
    if (!warned) {
      warned = true;
      console.warn("[streets] cache " + what + " failed", (e as Error | undefined)?.name);
    }
  };
  // the call's verdict on the store: a call that never touched it says nothing
  const settle = (state: CallState) => {
    if (!state.touched) return;
    if (!state.failed) {
      failedCalls = 0;
      return;
    }
    if (++failedCalls >= SKIP_AFTER && !skipStore) {
      skipStore = true;
      console.warn(
        "[streets] cache store skipped for this session after " +
          failedCalls +
          " failed calls (" +
          store.backend +
          ")",
      );
    }
  };

  const sound = (a: StreetAnswer) =>
    a.ways.every((w) => w && typeof w === "object") &&
    typeof a.groups === "object" &&
    Object.values(a.groups).every(
      (g) => g == null || typeof (g as Iterable<unknown>)[Symbol.iterator] === "function",
    );

  // The stored answer for a tile: {answer, stale}, or null. A store that throws counts as
  // empty for the rest of the call, so one dead database costs one failure, not one per tile.
  async function lookup(
    tile: Tile,
    state: CallState,
  ): Promise<{ answer: StreetAnswer; stale: boolean } | null> {
    if (state.storeDown) return null;
    state.touched = true;
    let entry: Stored | undefined;
    try {
      entry = (await store.get(keyOf(tile))) as Stored | undefined;
    } catch (e) {
      storeFailed(state, "read", e);
      return null;
    }
    // only the top-level shape StreetIndex reads (ways, groups); a stored answer without them would otherwise fail every run in the area
    const a = entry && entry.answer;
    if (!entry || !a || !Array.isArray(a.ways) || !a.groups || typeof entry.fetchedAt !== "number")
      return null;
    // the deeper check: a way that is not an object, or a group that cannot be iterated, would fail every run in the area too: a miss, and removed (a malformed field inside a way is not checked)
    if (!sound(a)) {
      store.delete(keyOf(tile)).catch(() => {});
      return null;
    }
    // a stamp ahead of now (clock moved back) cannot be trusted as fresh: refetch and overwrite it
    const age = now() - entry.fetchedAt;
    return { answer: a, stale: !(age >= 0 && age < maxAgeMs) };
  }

  // The street source contract of StreetIndex: onTile hears each tile as it arrives, cached tiles
  // first, and each network tile is stored the moment it arrives, so a failed run keeps it. An
  // expired copy never goes through onTile: served after a network failure (below), it comes back in
  // the returned Map alone. A failure rethrows the network's error as it is; ensureRects counts tiles.
  // The run's opts (its clock, busy wait and stale) go to the network source, so a busy wait keeps to
  // the run's deadline and stop, and a replaced run's posts still waiting for a slot are not sent.
  async function fetchStreets(
    tiles: Tile[],
    onTile?: OnTile,
    opts?: RunOptions,
  ): Promise<Map<string, StreetAnswer>> {
    const state: CallState = { storeDown: skipStore, touched: false, failed: false, puts: [] };
    // the writes are awaited on every exit, a stop from the caller's onTile included, so a failing one is counted
    try {
      return await run(tiles, onTile, opts, state);
    } finally {
      await Promise.all(state.puts);
      settle(state);
    }
  }

  async function run(
    tiles: Tile[],
    onTile: OnTile | undefined,
    opts: RunOptions | undefined,
    state: CallState,
  ): Promise<Map<string, StreetAnswer>> {
    const out = new Map<string, StreetAnswer>();
    const missing: Tile[] = [];
    const expired = new Map<string, StreetAnswer>(); // "x:y" -> an out-of-date answer, the fallback if the network is down
    let stopped = false; // the caller's onTile or busy wait threw (its stop, or a bug): no more tiles, stale ones included
    // a stored answer goes to onTile with {cached: true}: ensureRects counts only the others as downloaded
    const deliver = (t: Tile, answer: StreetAnswer, cached?: boolean) => {
      out.set(idOf(t), answer);
      if (!onTile) return;
      try {
        if (cached) onTile(t, answer, { cached: true });
        else onTile(t, answer);
      } catch (e) {
        stopped = true;
        throw e;
      }
    };
    for (const t of tiles) {
      const hit = await lookup(t, state);
      if (hit && !hit.stale) deliver(t, hit.answer, true);
      else {
        missing.push(t);
        if (hit) expired.set(idOf(t), hit.answer);
      }
    }
    if (!missing.length) return out;

    const puts = state.puts;
    const keep = (t: Tile, answer?: StreetAnswer) => {
      if (!answer || out.has(idOf(t))) return;
      if (!state.storeDown) {
        state.touched = true;
        puts.push(
          store
            .put(keyOf(t), { answer, fetchedAt: now() })
            .catch((e) => storeFailed(state, "write", e)),
        );
      }
      deliver(t, answer);
    };
    // a throw from the run's busy wait is the caller's stop too, like one from onTile
    const wait = opts && opts.wait;
    const netOpts = wait
      ? Object.assign({}, opts, {
          wait: async (until: number) => {
            try {
              return await wait(until);
            } catch (e) {
              stopped = true;
              throw e;
            }
          },
        })
      : opts;
    let fresh: Map<string, StreetAnswer> | undefined;
    try {
      fresh = await network(missing, keep, netOpts);
    } catch (e) {
      await Promise.all(puts);
      const left = missing.filter((t) => !out.has(idOf(t)));
      // old streets beat none when offline, but only if they cover everything still missing; a throw
      // with no outage reason is a bug, which old streets must not hide; a replaced run is given none
      if (
        stopped ||
        (opts && opts.stale && opts.stale()) ||
        !OUTAGE_REASONS.has((e as { reason?: string } | undefined)?.reason as string) ||
        !left.every((t) => expired.has(idOf(t)))
      )
        throw e;
      console.warn(
        "[streets] offline: serving " +
          left.length +
          " expired tile(s) from the cache (" +
          (e as { reason: string }).reason +
          ")",
      );
      // in the Map alone, past onTile: they cost no request, so the caller's per-tile stop (the run
      // deadline) must not cut them off
      for (const t of left) out.set(idOf(t), expired.get(idOf(t)) as StreetAnswer);
      return out;
    }
    // a network source may hand tiles over in its Map alone
    for (const t of missing) keep(t, fresh && fresh.get(idOf(t)));
    await Promise.all(puts);
    return out;
  }

  // Removes each entry whose name has no leading version number (numbered entries stay, so an older build never deletes a newer build's), at most LEGACY_SWEEP_MAX per call; the caller
  // starts it without awaiting. Resolves with how many went and never rejects.
  async function sweepLegacy() {
    let n = 0;
    try {
      const old = (await store.keys()).filter((k) => !/^\d+:/.test(k)).slice(0, LEGACY_SWEEP_MAX);
      for (const k of old) {
        await store.delete(k);
        n++;
      }
    } catch (e) {
      console.warn("[streets] cache sweep failed", (e as Error | undefined)?.name);
    }
    return n;
  }

  return { fetchStreets, sweepLegacy };
}

// What the page's `window.StreetCache` is made of.
export const StreetCache = { create };
