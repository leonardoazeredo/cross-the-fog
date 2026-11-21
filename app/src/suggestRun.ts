// The suggestion engine: the held street graph, the wrapper around one run, its street download, the two runs
// (A to B and loop) and the planning they share. Each function is a SuggestTool method, called with the tool as
// `this`, except `fitLoopSize`, which takes what it needs as arguments; none draws on the map. The two touches
// of the screen that remain are the runs' entries: they read the pin markers once (`getLatLng`) and start with
// `clearResults`, which both stay on the tool until the engine is given plain points.
import { createFogGain } from "./fogGain.ts";
import { lngLatToCell, WORLD_CELLS } from "./parser.ts";
import { GraphPlanner } from "./planner.ts";
import { LocalRouter } from "./router.ts";
import { sortOutcome } from "./streetDownload.ts";
import { HOLD_AS } from "./streetGrid.ts";
import {
  bearingApart,
  bearingRadius,
  dmax,
  dropRepeats,
  footprint,
  joinPins,
  loopBearingOf,
  metresPerDeg,
  overlapFrac,
  p2pCandidates,
  p2pWindow,
  rankKey,
  resampleMids,
  SAME_CORRIDOR,
  SAME_ROUTE,
  sharedFrac,
  snipOldSpurs,
  statsFromCoords,
} from "./suggestPure.ts";

// The tool and its candidates are plain objects built and read field by field; this file does not restructure them.
// biome-ignore lint/suspicious/noExplicitAny: see above
export type Self = { [field: string]: any };

const DEFAULT_BUFFER = 0.15; // p2p: max length over the fastest route, or ± around a wanted distance; loop: tolerance around target

// The street graph: what planning and routing (suggestions and the route editor) run on;
// built lazily, rebuilt when new streets arrive or the fog changes.
export function streetGraph(this: Self) {
  if (!this.streets || !this.streets.ways.length) return null;
  const had = this._planner;
  // a held graph stays with its suggestion: once the streets or the fog outgrew it, the slot gets a
  // fresh planner; any other one is rebuilt in place by build()
  if (!had || (had.held && !had.isCurrent()))
    this._planner = new (GraphPlanner as unknown as new (...a: unknown[]) => Self)(
      this.streets,
      this.streets.newFrac,
      undefined,
      undefined,
      () => this.fogMap.version || 0,
    );
  return this._planner;
}

// A suggestion plans on one graph from its first route to its last: a tile another run merges
// meanwhile (the route editor's) would rebuild it in place and renumber the edges, and a leg's
// `edges`, the avoid set of the way home, would name other streets.
// A fog change waits too; the gain is still scored on the fog as it is.
export function _holdGraph(this: Self, runId: any) {
  this._releaseGraph();
  const planner = this.streetGraph();
  if (!planner) return null;
  planner.build();
  planner.held = true;
  this._hold = { runId, planner };
  return planner;
}
// Ends any run in flight (its stale() turns true) and lets go of the graph it held.
export function _cancel(this: Self) {
  this._runId++;
  this._releaseGraph();
}
// runId: let go only of that run's graph (undefined: of whichever run holds one)
export function _releaseGraph(this: Self, runId: any) {
  const h = this._hold;
  if (!h || (runId !== undefined && h.runId !== runId)) return;
  h.planner.held = false;
  this._hold = null;
}
export function _graph(this: Self) {
  const h = this._hold;
  return h ? h.planner : this.streetGraph();
}

export async function suggest(this: Self, o: any) {
  o = o || {};
  const buffer = o.buffer || DEFAULT_BUFFER;
  const before = this._runId;
  const run =
    this.mode === "loop" ? this._suggestLoop(o.distM, buffer) : this._suggestP2P(buffer, o.targetM);
  // a run starts (clearResults) before its first await; one that never started holds nothing, and
  // the graph it would let go of is a running suggestion's
  const runId = this._runId;
  if (runId === before) return run;
  try {
    return await run;
  } finally {
    this._releaseGraph(runId);
  }
}

// Make sure the streets for the rects are loaded. Resolves true when they are and the run is
// still current; false when it is stale, or an error state was emitted: the download failed
// (`streets-fetch`) or reading the streets threw (`internal`). A stale run asks for no further
// tile, so a newer run is not queued behind it.
export async function _loadStreets(this: Self, rects: any, emit: any, stale: any) {
  // progress is heard only while some tile is missing from the index, so a rerun over covered
  // ground stays silent; waitUntil is set while a busy server is waited out
  const onProgress = (p: any) => emit(Object.assign({ loading: true, phase: "streets" }, p));
  const out = await sortOutcome(
    () => this.streets.ensureRects(rects, { onProgress, stale, holdAs: HOLD_AS.suggest }),
    stale,
  );
  switch (out.kind) {
    case "superseded":
      return false;
    case "bug":
      // a bug is not a failed download: the class only, as a message can name tiles. Logged even
      // when the run is stale, which only keeps it from being shown.
      console.error(
        "[suggest] reading streets threw",
        (out.error as { name?: string } | null)?.name,
      );
      if (!out.stale) emit({ error: true, reason: "internal" });
      return false;
    case "failed":
      console.warn("[suggest] streets unavailable", out.facts.reason);
      emit({ error: true, reason: "streets-fetch", download: out.facts });
      return false;
    default:
      return !out.stale;
  }
}

const MAX_VIAS = 6; // fog-seeking detour candidates per p2p run
const VIA_RETRIES = 2; // times a via is pulled back in when its route overshoots
const RETRACE_REROUTE_MIN = 0.12; // p2p: retraced share above which a via route's return leg is re-asked
const MAX_RETRACE_REROUTES = 2; // re-routed return legs per run
const MAX_P2P_M = 30000; // A and B farther apart than this need a street download past what we cap
const MAX_LOOP_M = 30000; // longer loops reach past the capped street download (bearing squares reach ~0.3x the length)
const MAX_LOOPS = 6; // bearings in the first batch when the planner found no routes
// Square-ish loop shapes as [bearing offset, distance factor] vias around the compass bearing.
// The same bearing at another shape takes the router over different streets, so a bearing whose
// square jumps from far too short to far too long (a river crossing) can still land in tolerance.
const LOOP_SHAPES = {
  square: [
    [-45, 1],
    [0, Math.SQRT2],
    [45, 1],
  ],
  narrow: [
    [-25, 1],
    [0, 1.6],
    [25, 1],
  ],
  fat: [
    [-60, 1],
    [0, 1.2],
    [60, 1],
  ],
};
const ALT_SHAPES = ["narrow", "fat"];
export const FIT_ROUTES = 6; // routes per size search, including the first: length jumps where a barrier sits, so a few tries beat one rescale
const CONCURRENCY = 3; // jobs interleaved by the pool

// ----- shared plumbing --------------------------------------------------------

// Local shortest path through the points over the street graph;
// null when there is no street data, a point is off the network, or no path exists.
// opts.avoid: Set of graph edge ids to discourage (a leg's `edges`).
export async function _route(this: Self, latlngs: any, opts: any) {
  const planner = this._graph();
  return planner
    ? new (LocalRouter as unknown as new (p: unknown) => Self)(planner).route(latlngs, opts)
    : null;
}

// Explained so the error can name the pin or pieces that failed instead of only failing.
export function _noRoute(this: Self, latlngs: any) {
  const planner = this._graph();
  if (!planner) return { error: true, reason: "no-street-data" };
  const why = new (LocalRouter as unknown as new (p: unknown) => Self)(planner).explain(latlngs);
  return { error: true, reason: why.reason || "no-path", why };
}

// Re-ask the leg after the via with the outbound streets avoided. null means keep the
// original: not a via route, no way home routed, or the way home is the same.
// The caller decides whether the new way home is worth taking.
export async function _rerouteReturn(this: Self, route: any, via: any, B: any) {
  if (route.legs.length !== 2) return null;
  const [out, home] = route.legs;
  const back = await this._route([via, B], { avoid: new Set(out.edges) });
  if (!back || !back.coords.length) return null;
  // the new route also starts with a stub from the via pin, so compare tails
  const tail = back.coords.slice(-home.coords.length);
  if (
    tail.length === home.coords.length &&
    tail.every((p: any, i: any) => p[0] === home.coords[i][0] && p[1] === home.coords[i][1])
  )
    return null;
  // the pin's stub is dropped; the way home then starts on the vertex the way out ended on
  return statsFromCoords(dropRepeats(out.coords.concat(back.coords.slice(1))));
}

// Share of never-visited cells within ~100 m of a point, used to steer candidates
// away from ground the user has already covered.
export function _newness(this: Self, latlng: any) {
  if (!this.newness) {
    this.newness = createFogGain({
      fogMap: this.fogMap,
      worldCells: WORLD_CELLS,
      lngLatToCell,
    }).newness;
  }
  return this.newness(latlng);
}

// Defoggable area (m²) reachable via the ways within rM of the point, or
// null where street data doesn't cover it. Null means: fall back to fog-only
// scoring. Raw fog can't tell a street grid from a lake; this can, and it is
// area-weighted so a lone path through virgin meadow scores what it's worth.
export function _newAreaM2(this: Self, latlng: any, rM: any) {
  if (!this.streets || !this.streets.covered(latlng.lat, latlng.lng)) return null;
  return this.streets.newAreaM2(latlng, rM);
}

// Pull a generation via to the most undefogged-street-rich spot within reach,
// so loops are born aimed at fogged streets instead of hoping a route
// passes them. The current spot keeps a bias and distance discounts a candidate, so
// the loop holds roughly its intended shape and length.
export function _snapToNewStreets(this: Self, ll: any, radiusM: any) {
  const base = this._newAreaM2(ll, 200);
  if (base === null || radiusM < 200) return ll;
  const { kx, ky } = metresPerDeg(ll.lat);
  // gentle keep-bias: in dense areas scores are high everywhere, so a strong
  // bias would freeze every via in place and the snapping would do nothing
  let best = ll,
    bs = base * 1.05 + 600;
  const step = Math.max(150, radiusM / 3);
  for (let dy = -radiusM; dy <= radiusM; dy += step) {
    for (let dx = -radiusM; dx <= radiusM; dx += step) {
      if (!dx && !dy) continue;
      const p = { lat: ll.lat + dy / ky, lng: ll.lng + dx / kx };
      const m = this._newAreaM2(p, 200);
      if (m === null) continue;
      const s = m * (1 - Math.hypot(dx, dy) / (radiusM * 2.2));
      if (s > bs) {
        bs = s;
        best = p;
      }
    }
  }
  return best;
}

// Run jobs (thunks returning a promise) through a small worker pool, reporting progress.
// Routing is synchronous, so each job waits a turn first to let the page repaint.
export async function _pool(this: Self, jobs: any, stale: any, onTick: any) {
  const out: any[] = [];
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < jobs.length && !stale()) {
      const j = jobs[next++];
      await new Promise((res) => setTimeout(res));
      if (stale()) return;
      const r = await j();
      if (stale()) return;
      done++;
      onTick(done);
      if (r) out.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return out;
}

// Show three routes that go different ways rather than three variations on
// one. Loops are separated by direction: a candidate is taken only if no
// already-taken loop heads within 60 degrees of it (heading = start pin to
// the loop's farthest point). Angular distance, so headings either side of
// due north (350 and 10 degrees) count as the same direction. A→B has a
// fixed direction, so those are separated by ground instead: a candidate is
// taken only if less than SAME_CORRIDOR of its length runs along a route
// already taken, which catches the real failure, two routes sharing a middle.
// Whatever either rule defers is appended best-first, so where the geography
// offers only one or two ways (water, a dead end, one bridge) the deck still
// fills and this never invents variety that isn't there.
export function _diversify(this: Self, ranked: any, extra: any, kx: any, ky: any, S: any) {
  if (ranked.length <= 2) return ranked;
  const loop = extra.targetKm != null;
  if (loop && !S) return ranked;
  let differs: any;
  if (loop) {
    for (const c of ranked) c._brg = loopBearingOf(S, c.r.coords);
    differs = (c: any, taken: any) => taken.every((o: any) => bearingApart(o._brg, c._brg) > 60);
  } else {
    differs = (c: any, taken: any) =>
      taken.every((o: any) => sharedFrac(c.r.coords, o.cells, kx, ky) < SAME_CORRIDOR);
  }
  const picked: any[] = [],
    rest: any[] = [];
  for (const c of ranked) (differs(c, picked) ? picked : rest).push(c);
  return picked.concat(rest);
}

// The engine half of a finished run: score, rank, dedupe and diversify the candidates. Returns
// {results}, the (at most three) routes to show, or {empty}, the state to emit when there is nothing to show.
export function _rank(this: Self, cands: any, extra: any, S?: any) {
  if (!cands.length) return { empty: Object.assign({ empty: true }, extra) };
  // Score first, rank, THEN dedupe, because near-identical routes must collapse onto the
  // best-gaining of the pair, not whichever happened to be scored first.
  let scored = cands.map((c: any) =>
    Object.assign(
      {
        gain: this.computeGain(c.r.coords) || { area: 0, newPct: 0 },
      },
      c,
    ),
  );
  // a route that breaks <1% new ground isn't a suggestion, it's a re-walk
  scored = scored.filter((c: any) => c.gain.area > 0 && c.gain.newPct >= 1);
  if (!scored.length) return { empty: Object.assign({ empty: true, reason: "defogged" }, extra) };
  // A to B also loses up to RETRACE_WEIGHT of its score in proportion to the share it
  // retraces (rankKey); loops use the plain key below.
  // rank by area, blended with share-of-length-on-new-ground: between two
  // routes that defog the same area, the one that isn't mostly a re-walk wins
  const key =
    extra.baseKm != null
      ? (c: any) => {
          c.retrace = overlapFrac(c.r.coords, false);
          return rankKey(c.gain, c.retrace);
        }
      : (c: any) => c.gain.area * (0.7 + 0.3 * Math.min(1, c.gain.newPct / 100));
  for (const c of scored) c.key = key(c);
  scored.sort((x: any, y: any) => y.key - x.key);
  // One local metric frame for the whole run, so footprints are comparable.
  const { kx, ky } = metresPerDeg(scored[0].r.coords[0][1]);
  const unique: any[] = [];
  for (const c of scored) {
    if (unique.some((o) => sharedFrac(c.r.coords, o.cells, kx, ky) > SAME_ROUTE)) continue;
    c.cells = footprint(c.r.coords, kx, ky);
    unique.push(c);
  }
  return { results: this._diversify(unique, extra, kx, ky, S).slice(0, 3) };
}

// ----- point-to-point ---------------------------------------------------------

// Point at fraction t along A→B, offset d metres perpendicular on the given side.
export function _viaPoint(this: Self, A: any, B: any, t: any, side: any, d: any) {
  const { kx, ky } = metresPerDeg((A.lat + B.lat) / 2);
  const ax = A.lng * kx,
    ay = A.lat * ky,
    bx = B.lng * kx,
    by = B.lat * ky;
  const L2 = Math.hypot(bx - ax, by - ay);
  if (L2 < 100) return null;
  const px = -(by - ay) / L2,
    py = (bx - ax) / L2;
  return {
    lat: (ay + (by - ay) * t + py * side * d) / ky,
    lng: (ax + (bx - ax) * t + px * side * d) / kx,
  };
}

export function _viaCandidates(this: Self, A: any, B: any, budgetM: any) {
  const { kx, ky } = metresPerDeg((A.lat + B.lat) / 2);
  const L2 = Math.hypot((B.lng - A.lng) * kx, (B.lat - A.lat) * ky);
  if (L2 < 100) return [];
  const cands = [];
  for (const t of [0.3, 0.5, 0.7]) {
    // 0.85: real roads are longer than the straight-line bound, so aim inside it
    const dm = dmax(t, L2, budgetM) * 0.85;
    for (const side of [1, -1]) {
      for (const scale of [1, 0.5]) {
        // full and medium detours at every station
        const d = dm * scale;
        if (d < 150) continue; // not a meaningful detour
        const ll = this._viaPoint(A, B, t, side, d);
        cands.push({ latlng: ll, scale, t, side, d });
      }
    }
  }
  return cands;
}

// Rank via candidates by defoggable area via ways within 350 m when street
// data covers them all, by fog newness otherwise.
// Rank within each detour size, then take half from each. Far offsets always
// look richer but often route over the length budget; medium ones fit reliably, and
// ranking them together would fill every MAX_VIAS slot from the far side.
export function _pickVias(this: Self, cands: any) {
  for (const c of cands) {
    c.areaM2 = this._newAreaM2(c.latlng, 350);
    if (c.areaM2 === null) c.newness = this._newness(c.latlng);
  }
  const street = cands.length > 0 && cands.every((c: any) => c.areaM2 !== null);
  // floors: below ~2000 m² reachable (or 5% new fog) a detour is too thin to be worth a candidate slot
  const ok = (c: any) => (street ? c.areaM2 >= 2000 : c.newness >= 0.05);
  const val = (c: any) => (street ? c.areaM2 : c.newness);
  const rank = (sc: any) =>
    cands.filter((c: any) => c.scale === sc && ok(c)).sort((a: any, b: any) => val(b) - val(a));
  const full = rank(1),
    med = rank(0.5);
  const take = Math.ceil(MAX_VIAS / 2);
  const picked = full.slice(0, take).concat(med.slice(0, take));
  // top up from whichever side has leftovers if the other ran short
  for (const c of full.slice(take).concat(med.slice(take)))
    if (picked.length < MAX_VIAS) picked.push(c);
  return picked.slice(0, MAX_VIAS);
}

export async function _suggestP2P(this: Self, buffer: any, targetM: any) {
  if (!this.a || !this.b) return;
  this.clearResults();
  const runId = this._runId;
  const stale = () => runId !== this._runId;
  const emit = (s: any) => {
    if (!stale() && this.onResults) this.onResults(s);
  };
  const A = this.a.getLatLng(),
    B = this.b.getLatLng();
  const bufferPct = Math.round(buffer * 100);

  emit({ loading: true, phase: "baseline" });
  if (!this.streets) {
    emit({ error: true, reason: "no-street-data" });
    return;
  }

  // Streets first: routing runs on them. The budget isn't known until A to B is
  // routed, so size the box for a fastest route up to 1.5x the straight line and
  // pad it by how far sideways the longest allowed detour can reach.
  const { kx, ky } = metresPerDeg((A.lat + B.lat) / 2);
  const straightM = Math.hypot((B.lng - A.lng) * kx, (B.lat - A.lat) * ky);
  if (straightM > MAX_P2P_M) {
    emit({ empty: true, reason: "too-far", maxKm: MAX_P2P_M / 1000 });
    return;
  }
  const reachM = Math.max(targetM || 0, straightM * 1.5) * (1 + buffer);
  const pad = Math.min(
    4000,
    Math.sqrt(Math.max(0, reachM * reachM - straightM * straightM)) / 2 + 300,
  );
  // pins snapped to the cache grid (as for loops); the extra 400 m absorbs the snap offset
  const sa = this.streets.snapPoint(A),
    sb = this.streets.snapPoint(B),
    m = pad + 400;
  const rects = [
    {
      s: Math.min(sa.lat, sb.lat) - m / ky,
      n: Math.max(sa.lat, sb.lat) + m / ky,
      w: Math.min(sa.lng, sb.lng) - m / kx,
      e: Math.max(sa.lng, sb.lng) + m / kx,
    },
  ];
  if (!(await this._loadStreets(rects, emit, stale))) return;
  this._holdGraph(runId);

  const base = await this._route([A, B]);
  if (stale()) return;
  if (!base) {
    emit(this._noRoute([A, B]));
    return;
  }
  const win = p2pWindow(base.lenM, targetM, buffer);
  const { want, clamped, budget, floor, aim } = win;
  const rawVias = this._viaCandidates(A, B, budget);

  // The graph planner proposes whole A-to-B walks through rewarding streets.
  // Skipped in mostly-virgin areas, where simple detours already defog near
  // the ceiling.
  let planned = [];
  if (budget <= 12000) {
    const planner = this._graph();
    if (planner) {
      const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
      try {
        if (planner.meanFracNear(mid, Math.min(1800, budget * 0.25)) < 0.82)
          planned = planner.planP2P(A, B, budget, 3);
      } catch (e) {}
    }
  }

  let reroutes = 0;
  // candidate jobs: the planner's walks + our street/fog-seeking via-points
  const jobs = [];
  for (const pl of planned)
    jobs.push(async () => {
      const r = statsFromCoords(pl.coords);
      if (r.lenM > budget * 1.02) return null;
      const snip = snipOldSpurs(r.coords, this.computeGain, floor);
      if (snip.coords)
        return {
          r: statsFromCoords(snip.coords),
          adoptWps: [A].concat(resampleMids(snip.coords, 4), [B]),
        };
      return { r, adoptWps: pl.wps };
    });
  // planner plans ADD to the via candidates, they don't replace them: the
  // geometric vias are proven earners and cutting them for weaker plans
  // would drop p2p's best card. Trim only slightly to bound the run time.
  for (const v of this._pickVias(rawVias).slice(0, planned.length ? MAX_VIAS - 1 : MAX_VIAS))
    jobs.push(async () => {
      // Real streets inflate the straight-line ellipse the via was placed
      // inside, so a via route usually overshoots the budget. Pull the via
      // back toward the line and re-ask, up to VIA_RETRIES times, each time
      // rescaling from the length just measured rather than from the first
      // guess: one shot assumes routed length grows evenly with the offset,
      // which fails around a barrier like a river: every detour then
      // overshoots twice over and is binned, leaving only the plain fastest
      // route and the planner's walks.
      let ll = v.latlng,
        d = v.d;
      let r = await this._route([A, ll, B]);
      // a replaced run builds no further via
      if (stale()) return null;
      let best = r,
        bestLl = ll;
      for (let k = 0; k < VIA_RETRIES; k++) {
        // 3: past this, pulling the via in will not help: it is in the wrong place entirely
        if (!r || !r.lenM || r.lenM <= budget || r.lenM <= base.lenM || r.lenM > budget * 3) break;
        const shrink = Math.max(0.2, Math.min(0.9, (aim - base.lenM) / (r.lenM - base.lenM)));
        const d2 = d * shrink;
        const ll2 = d2 >= 120 ? this._viaPoint(A, B, v.t, v.side, d2) : null;
        if (!ll2) break;
        const r2 = await this._route([A, ll2, B]);
        if (stale()) return null;
        if (!r2 || !r2.lenM) break;
        // pulling the via in usually shortens the route but not always, so keep
        // the shortest seen rather than the last: the loop stops at the first
        // one that fits, so that's the one this holds on to
        if (!best.lenM || r2.lenM < best.lenM) {
          best = r2;
          bestLl = ll2;
        }
        r = r2;
        ll = ll2;
        d = d2;
      }
      r = best;
      ll = bestLl;
      // a wanted distance also has a floor: one regrow pass when the via fell short of it
      if (want && r && r.lenM && r.lenM < floor && r.lenM > base.lenM) {
        const grow = Math.max(1.1, Math.min(3, (aim - base.lenM) / (r.lenM - base.lenM)));
        const ll2 = this._viaPoint(A, B, v.t, v.side, d * grow);
        const r2 = ll2 ? await this._route([A, ll2, B]) : null;
        if (r2 && r2.lenM && r2.lenM > r.lenM && r2.lenM <= budget * 1.02) {
          r = r2;
          ll = ll2;
        }
      }
      // 1.02: don't bin a route for skimming the budget by metres
      if (!r || !r.lenM || r.lenM > budget * 1.02) return null;
      let adoptWps = joinPins(r, A, B);
      const gainOf = (x: any) => this.computeGain(x.coords) || { area: 0, newPct: 0 };
      const retrace = overlapFrac(r.coords, false);
      if (retrace >= RETRACE_REROUTE_MIN && reroutes < MAX_RETRACE_REROUTES) {
        reroutes++;
        const rr = await this._rerouteReturn(r, ll, B);
        if (stale()) return null;
        if (
          rr &&
          rr.lenM >= floor &&
          rr.lenM <= budget * 1.02 &&
          rankKey(gainOf(rr), overlapFrac(rr.coords, false)) > rankKey(gainOf(r), retrace)
        ) {
          r = rr;
          // the editor can't avoid streets: pin the new way home with waypoints
          adoptWps = [A].concat(
            resampleMids(r.coords, Math.max(4, Math.min(8, Math.round(r.lenM / 500)))),
            [B],
          );
        }
      }
      const snip = snipOldSpurs(r.coords, this.computeGain, floor);
      if (snip.coords)
        return {
          r: statsFromCoords(snip.coords),
          adoptWps: [A].concat(resampleMids(snip.coords, 3), [B]),
        };
      return { r, adoptWps };
    });

  const total = jobs.length;
  emit({ loading: true, phase: "detours", done: 0, total });
  const found = await this._pool(jobs, stale, (done: any) =>
    emit({ loading: true, phase: "detours", done, total }),
  );
  if (stale()) return;
  const { list, fallback } = p2pCandidates(found, { r: base, adoptWps: [A, B], isBase: true }, win);
  this._finish(runId, list, {
    baseKm: base.lenM / 1000,
    bufferPct,
    wantKm: want ? want / 1000 : null,
    clamped,
    fallback,
  });
}

// ----- loops ------------------------------------------------------------------

// Rank compass bearings by how much undefogged STREET lies out that way
// (fog-only newness as fallback): sample at two ranges along each of 12
// bearings, then greedily pick well-separated winners. Street scoring stops
// bearings aiming at rivers, parks and fields that look richly foggy but
// hold nothing to defog.
export function _loopBearings(this: Self, S: any, distM: any) {
  const { kx, ky } = metresPerDeg(S.lat);
  const at = (thDeg: any, m: any) => {
    const th = (thDeg * Math.PI) / 180;
    return { lat: S.lat + (Math.cos(th) * m) / ky, lng: S.lng + (Math.sin(th) * m) / kx };
  };
  const R = bearingRadius(distM);
  const score = (p: any) => {
    const st = this._newAreaM2(p, R);
    return st !== null ? st : this._newness(p) * 2 * R * 30; // fallback on a roughly comparable scale
  };
  const scored = [];
  for (let b = 0; b < 360; b += 30)
    scored.push({ b, score: (score(at(b, distM * 0.25)) + score(at(b, distM * 0.4))) / 2 });
  scored.sort((x, y) => y.score - x.score);
  const picked: any[] = [];
  for (const s of scored) {
    if (picked.every((p) => bearingApart(p, s.b) >= 45)) picked.push(s.b);
  }
  return picked;
}

// Loop S → v1 → v2 → v3 → S out along a bearing; `shape` picks a LOOP_SHAPES entry. For
// "square" (S and three vias as the corners) a is the edge and the straight perimeter 4a;
// the other shapes use a as their via distance only. Three vias give the router much
// less room than a 2-via triangle to fold the loop into out-and-back spurs.
export function _loopVias(this: Self, S: any, bearingDeg: any, a: any, shape = "square") {
  const { kx, ky } = metresPerDeg(S.lat);
  const at = (thDeg: any, m: any) => {
    const th = (thDeg * Math.PI) / 180;
    return { lat: S.lat + (Math.cos(th) * m) / ky, lng: S.lng + (Math.sin(th) * m) / kx };
  };
  return ((LOOP_SHAPES as Record<string, number[][]>)[shape] as number[][])
    .map(([off, f]: any) => at(bearingDeg + off, a * f))
    .map((v: any) => this._snapToNewStreets(v, a * 0.3));
}

// Triangle fallback (2 vias, side D/3.75): used when the square's vias land
// where the router can't start (water, restricted areas, off the street network). Fewer points, fewer chances to fail.
export function _loopViasTri(this: Self, S: any, bearingDeg: any, side: any) {
  const { kx, ky } = metresPerDeg(S.lat);
  const at = (thDeg: any) => {
    const th = (thDeg * Math.PI) / 180;
    return { lat: S.lat + (Math.cos(th) * side) / ky, lng: S.lng + (Math.sin(th) * side) / kx };
  };
  return [at(bearingDeg - 30), at(bearingDeg + 30)].map((v) =>
    this._snapToNewStreets(v, side * 0.3),
  );
}

// Finds the square size whose cleaned route lands in tolerance. Route length is not
// monotone in size (a far bridge makes it jump), so bracket the target between the
// largest short size and the smallest long or unroutable one, and give up after a
// fixed budget with the closest candidate seen.
export async function fitLoopSize(
  prep: any,
  dim0: any,
  first: any,
  distM: any,
  buffer: any,
  stale: any,
) {
  const floor = distM * (1 - buffer),
    ceil = distM * (1 + buffer);
  // 2 for out of tolerance, +1 for a snip the tolerance floor blocked: regrowing by the blocked amount makes the cut affordable
  const badness = (x: any) =>
    (x.r.lenM >= floor && x.r.lenM <= ceil ? 0 : 2) + (x.blockedM > 0 ? 1 : 0);
  const closer = (a: any, b: any) =>
    badness(a) < badness(b) ||
    (badness(a) === badness(b) && Math.abs(a.r.lenM - distM) < Math.abs(b.r.lenM - distM));
  const tried = new Set([dim0]);
  let best = first,
    lo: any = null,
    hi: any = null,
    last = { dim: dim0, c: first };
  const note = (dim: any, c: any) => {
    if (!c || c.r.lenM > ceil) {
      if (!hi || dim < hi.dim) hi = { dim, lenM: c ? c.r.lenM : null };
    } else if (c.r.lenM < floor) {
      if (!lo || dim > lo.dim) lo = { dim, lenM: c.r.lenM };
    }
  };
  note(dim0, first);
  for (let n = 1; n < FIT_ROUTES && badness(best) > 0; n++) {
    let dim: any;
    if (lo && hi) {
      // an unroutable hi has no length to interpolate on: bisect
      const t = hi.lenM == null ? 0.5 : (distM - lo.lenM) / (hi.lenM - lo.lenM);
      dim = lo.dim + Math.min(0.9, Math.max(0.1, t)) * (hi.dim - lo.dim);
    } else if (last.c) {
      dim = last.dim * Math.min(2.5, Math.max(0.4, (distM + last.c.blockedM) / last.c.r.lenM));
    } else {
      dim = hi.dim * 0.6;
    }
    if (tried.has(dim)) break;
    tried.add(dim);
    const c = await prep(dim);
    last = { dim, c };
    note(dim, c);
    if (c && closer(c, best)) best = c;
    if (stale()) break;
  }
  return best;
}

export async function _suggestLoop(this: Self, distM: any, buffer: any) {
  if (!this.a || !distM) return;
  this.clearResults();
  const runId = this._runId;
  const stale = () => runId !== this._runId;
  const emit = (s: any) => {
    if (!stale() && this.onResults) this.onResults(s);
  };
  const S = this.a.getLatLng();
  const bufferPct = Math.round(buffer * 100);
  if (distM > MAX_LOOP_M) {
    emit({
      empty: true,
      reason: "too-long",
      targetKm: distM / 1000,
      bufferPct,
      maxKm: MAX_LOOP_M / 1000,
    });
    return;
  }
  const inTol = (lenM: any) => Math.abs(lenM - distM) <= buffer * distM;

  // Streets first: routing runs on them, and bearings and vias chase undefogged
  // streets rather than raw fog. One rect around the whole reach, capped so a
  // very long loop downloads a bounded area (its far side may then be out of
  // reach).
  if (!this.streets) {
    emit({ error: true, reason: "no-street-data" });
    return;
  }
  const { kx, ky } = metresPerDeg(S.lat);
  // build the fetch area around a grid-snapped centre so a rerun (same
  // or slightly nudged pin) reuses the cache; the planner still uses the
  // true S, and the area's 800 m margin absorbs the snap offset
  const c = this.streets.snapPoint(S);
  const half = Math.min(distM * 0.45 + 800, 9000);
  const rects = [
    { s: c.lat - half / ky, n: c.lat + half / ky, w: c.lng - half / kx, e: c.lng + half / kx },
  ];
  if (!(await this._loadStreets(rects, emit, stale))) return;
  const planner = this._holdGraph(runId);
  if (!planner) {
    emit({ error: true, reason: "no-street-data" });
    return;
  }

  // Search the street network itself for high-defog loops (thin shapes, odd
  // topologies: whatever the fog asks for). Only for distances the capped rect
  // reaches whole, and only where new ground is scarce enough that shape
  // matters: in mostly-virgin areas wide simple loops already defog near the
  // ceiling and planned walks do not pay there.
  let planned = [];
  if (distM <= 16000) {
    try {
      if (planner.meanFracNear(S, Math.min(1800, distM * 0.18)) < 0.82)
        planned = planner.planLoop(S, distM, buffer, 4);
    } catch (e) {}
  }
  // With planner candidates in hand, compass-square candidates become a
  // safety net, but a real one: in dense fringe the best square still beats
  // the best plan at times, so the first batch is three bearings when plans are plentiful,
  // four with one or two, and MAX_LOOPS when there are none.
  // The ranked bearings left over, and the first batch again as other shapes, are a second
  // wave, run only if too few directions came out.
  const ranked = this._loopBearings(S, distM);
  const firstN = planned.length >= 3 ? 3 : planned.length >= 1 ? 4 : MAX_LOOPS;
  const bearings = ranked.slice(0, firstN);
  const total = bearings.length + planned.length;
  emit({ loading: true, phase: "loops", done: 0, total });

  // Roads inflate the straight square (4a) by ~25%, so the square starts with perimeter = distM/1.25;
  // the other shapes start at the same size and rely on fitLoopSize.
  // If the routed loop misses the tolerance, fitLoopSize searches for a size that lands in it;
  // if the square doesn't route at all, fall back to a triangle on the same bearing.
  const loopWps = (vias: any) => [S].concat(vias, [S]);
  const fails = { server: 0, tol: 0 };
  const floor = distM * (1 - buffer);
  const plannedJobs = planned.map((pl: any) => async () => {
    const raw = statsFromCoords(pl.coords);
    const snip = snipOldSpurs(raw.coords, this.computeGain, floor);
    const c = snip.coords
      ? { r: statsFromCoords(snip.coords), adoptWps: [S].concat(resampleMids(snip.coords, 6), [S]) }
      : { r: raw, adoptWps: pl.wps };
    if (!inTol(c.r.lenM)) {
      fails.tol++;
      return null;
    }
    return { r: c.r, adoptWps: c.adoptWps, overlap: overlapFrac(c.r.coords), planned: true };
  });
  const squareJob =
    (bearing: any, shape = "square") =>
    async () => {
      let mk = (d: any) => this._loopVias(S, bearing, d, shape);
      // route + snip in one step, so the tolerance check and fitLoopSize's size search
      // both judge the CLEANED length, so a loop whose snips pull it under target gets regrown, not binned
      const prep = async (d: any) => {
        const vias = mk(d);
        const raw = await this._route(loopWps(vias));
        if (!raw || !raw.lenM) return null;
        const snip = snipOldSpurs(raw.coords, this.computeGain, floor);
        return snip.coords
          ? {
              r: statsFromCoords(snip.coords),
              adoptWps: [S].concat(resampleMids(snip.coords, 4), [S]),
              blockedM: snip.blockedM,
            }
          : { r: raw, adoptWps: joinPins(raw, S, S), blockedM: snip.blockedM };
      };
      let dim = distM / 5;
      let c: any = await prep(dim);
      // the triangle on this bearing is shape-independent: a retry in another shape would only repeat it
      if (!c && shape === "square") {
        mk = (d) => this._loopViasTri(S, bearing, d);
        dim = distM / 3.75;
        c = await prep(dim);
      }
      if (!c) {
        fails.server++;
        return null;
      }
      c = await fitLoopSize(prep, dim, c, distM, buffer, stale);
      if (!inTol(c.r.lenM)) {
        fails.tol++;
        return null;
      }
      return { r: c.r, adoptWps: c.adoptWps, overlap: overlapFrac(c.r.coords) };
    };

  const tick = (phase: any, count: any) => (done: any) =>
    emit({ loading: true, phase, done, total: count });
  const found = await this._pool(
    plannedJobs.concat(bearings.map((b: any) => squareJob(b))),
    stale,
    tick("loops", total),
  );
  if (stale()) return;
  // _diversify gives a card to a loop only when its direction differs by more than 60 degrees
  // from the earlier ones (deferred loops just fill up); fewer than three distinct directions
  // means the second wave (unused bearings, other shapes) may add some
  const directions = () => {
    const dirs: any[] = [];
    // counted over what the overlap filter below will keep, or retracing loops would hide a short deck
    for (const c of found.filter((x: any) => x.planned || x.overlap <= 0.3)) {
      const b = loopBearingOf(S, c.r.coords);
      if (dirs.every((o) => bearingApart(o, b) > 60)) dirs.push(b);
    }
    return dirs.length;
  };
  // leftover bearings as squares, then the first batch again one alternate shape at a time,
  // each stage only while directions are still short (each stage routes every bearing again, so later stages are skipped once directions are in)
  const stages = [ranked.slice(firstN).map((b: any) => squareJob(b))]
    .concat(ALT_SHAPES.map((sh) => bearings.map((b: any) => squareJob(b, sh))))
    .filter((st) => st.length);
  for (const st of stages) {
    if (directions() >= 3) break;
    emit({ loading: true, phase: "shapes", done: 0, total: st.length });
    found.push(...(await this._pool(st, stale, tick("shapes", st.length))));
    if (stale()) return;
  }
  if (!found.length && fails.server > 0 && fails.tol === 0) {
    // nothing routed at all, a server problem, not a tolerance problem; say so
    emit({ empty: true, reason: "server", targetKm: distM / 1000, bufferPct });
    return;
  }
  // Drop square candidates that retrace >30% of themselves: for THEM overlap
  // is a generation defect (a square folding into out-and-back
  // spurs). Planned routes are exempt: when the planner retraces, it decided
  // the retrace pays (e.g. a bridge is the only way over and back, and a
  // "lollipop" out to rich streets beats a forced giant detour).
  const clean = found.filter((c: any) => c.planned || c.overlap <= 0.3);
  this._finish(runId, clean.length ? clean : found, { targetKm: distM / 1000, bufferPct }, S);
}
