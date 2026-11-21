// The suggestion engine's pure helpers: route geometry, scoring and ranking over plain coordinates, no map, no DOM.
import { Estimates } from "./estimates.ts";

export const RETRACE_WEIGHT = 0.5; // p2p: share of a route's score lost if all of it retraces itself

// Same split as the drawn route: solid runs where the route breaks new ground,
// dashed ("hatched") runs where it crosses ground that's already defogged.
export function splitRuns(coords: any, isNew: any) {
  const newRuns: any[] = [],
    oldRuns: any[] = [];
  let cur: boolean | null = null,
    run: any = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i],
      b = coords[i + 1];
    const isN = isNew ? isNew((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) : true;
    if (cur === null) {
      cur = isN;
      run = [[a[1], a[0]]];
    } else if (isN !== cur) {
      (cur ? newRuns : oldRuns).push(run);
      cur = isN;
      run = [[a[1], a[0]]];
    }
    run.push([b[1], b[0]]);
  }
  if (run) (cur ? newRuns : oldRuns).push(run);
  return { newRuns, oldRuns };
}

// How much of one route runs along another, used to drop near-duplicates
// (e.g. a via candidate that snapped onto the same roads as a planned
// route) and to keep the three shown routes from sharing a corridor.
// Routes are walked in fixed metre steps rather than by point index, so the
// answer doesn't depend on how densely the route's coordinates are sampled, and
// one route's path is stamped into a grid of NEAR_CELL squares and the other
// is counted as alongside it wherever it lands within NEAR_PAD squares of a
// stamped one. "Runs along" therefore means "within about 30 m", and
// comparing two routes costs one walk of each rather than a test of every
// segment against every other segment.
export const NEAR_CELL = 15; // metres per grid square
export const NEAR_PAD = 2; // squares of slack allowed when matching
export const SAME_ROUTE = 0.9; // above this share it's the same route again, never show it
export const SAME_CORRIDOR = 0.6; // above this it's the same way there, show it only to fill a slot

// Call fn(x, y, lenM) at the midpoint of every stepM-long piece of the route,
// in a local metric frame.
export function walk(coords: any, kx: any, ky: any, stepM: any, fn: any) {
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][0] * kx,
      ay = coords[i - 1][1] * ky;
    const bx = coords[i][0] * kx,
      by = coords[i][1] * ky;
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 0; k < n; k++)
      fn(ax + ((bx - ax) * (k + 0.5)) / n, ay + ((by - ay) * (k + 0.5)) / n, d / n);
  }
}

// The grid squares a route passes through.
export function footprint(coords: any, kx: any, ky: any) {
  const cells = new Set();
  walk(coords, kx, ky, NEAR_CELL, (x: any, y: any) =>
    cells.add(Math.round(x / NEAR_CELL) + "," + Math.round(y / NEAR_CELL)),
  );
  return cells;
}

export function nearCells(cells: any, x: any, y: any) {
  const cx = Math.round(x / NEAR_CELL),
    cy = Math.round(y / NEAR_CELL);
  for (let dx = -NEAR_PAD; dx <= NEAR_PAD; dx++)
    for (let dy = -NEAR_PAD; dy <= NEAR_PAD; dy++)
      if (cells.has(cx + dx + "," + (cy + dy))) return true;
  return false;
}

// Share of this route's length (0..1) that runs alongside the footprint.
// Deliberately one-directional: the question is how much of THIS route the
// reader has already seen, so a short route inside a long one scores high,
// while a long route that merely contains a short one does not.
export function sharedFrac(coords: any, cells: any, kx: any, ky: any) {
  let total = 0,
    shared = 0;
  walk(coords, kx, ky, NEAR_CELL, (x: any, y: any, len: any) => {
    total += len;
    if (nearCells(cells, x, y)) shared += len;
  });
  return total ? shared / total : 0;
}

// deg -> local metres around a latitude
export function metresPerDeg(lat: any) {
  return { kx: 111320 * Math.cos((lat * Math.PI) / 180), ky: 110540 };
}

// Compass bearing from S to the farthest point of a loop: what "direction" means for a loop.
export function loopBearingOf(S: any, coords: any) {
  let far = coords[0],
    fd = -1;
  for (const p of coords) {
    const d = (p[1] - S.lat) * (p[1] - S.lat) + (p[0] - S.lng) * (p[0] - S.lng);
    if (d > fd) {
      fd = d;
      far = p;
    }
  }
  return ((Math.atan2(far[0] - S.lng, far[1] - S.lat) * 180) / Math.PI + 360) % 360;
}

export function bearingApart(a: any, b: any) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Largest perpendicular offset at fraction t along A→B whose straight-line via-path still
// fits the budget (a lower bound on the routed length, so a safe outer limit).
export function dmax(t: any, L: any, budget: any) {
  let lo = 0,
    hi = budget;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (Math.hypot(t * L, mid) + Math.hypot((1 - t) * L, mid) <= budget) lo = mid;
    else hi = mid;
  }
  return lo;
}

// The length window of an A to B run. With a wanted distance it is want ± buffer, never
// below the fastest route; one shorter than that is clamped up to it and reported as such.
export function p2pWindow(baseM: any, targetM: any, buffer: any) {
  const want = targetM > 0 ? Math.max(targetM, baseM) : null;
  const clamped = want != null && targetM < baseM;
  const budget = (want || baseM) * (1 + buffer);
  const floor = want ? Math.max(baseM, want * (1 - buffer)) : 0;
  // where re-aimed vias should land: the wanted length, but no closer than halfway into
  // the buffer above the fastest route, so a clamped target doesn't aim at the fastest
  // route itself. With no wanted distance, just inside the budget: the best detours live
  // right at the edge.
  const aim = want ? Math.max(want, baseM * (1 + buffer / 2)) : baseM + 0.95 * (budget - baseM);
  return { want, clamped, budget, floor, aim };
}

// Candidates worth ranking. The fastest route is a normal candidate unless a wanted
// distance puts it under the floor; then it only shows (fallback) when nothing else fits.
export function p2pCandidates(found: any, base: any, win: any) {
  const list = found.filter((c: any) => c.r.lenM >= win.floor);
  const baseFits = base.r.lenM >= win.floor;
  if (!win.want || baseFits || !list.length) list.unshift(base);
  return { list, fallback: win.want != null && !baseFits && list.length === 1 && list[0] === base };
}

// Scoring radius for a bearing sample: wide enough to see a neighbourhood,
// scaled with the loop so long rides judge whole districts.
export function bearingRadius(distM: any) {
  return Math.min(800, Math.max(300, distM * 0.05));
}

// Share of the route's length that runs within ~25 m of another, path-distant part of
// itself. High values mean out-and-back spurs rather than a proper loop.
// closed=false (A to B): the start and end are unrelated, so no wrap-around adjacency,
// and high values mean the route re-walks earlier ground.
export function overlapFrac(coords: any, closed = true) {
  const { kx, ky } = metresPerDeg(coords.length ? coords[0][1] : 0);
  const d2 = (p: any, q: any) => {
    const dx = p.x - q.x,
      dy = p.y - q.y;
    return dx * dx + dy * dy;
  };
  const pts = [];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][0] * kx,
      ay = coords[i - 1][1] * ky;
    const bx = coords[i][0] * kx,
      by = coords[i][1] * ky;
    const len = Math.hypot(bx - ax, by - ay);
    pts.push({ x: (ax + bx) / 2, y: (ay + by) / 2, len, at: acc + len / 2 });
    acc += len;
  }
  let overlap = 0,
    total = 0;
  for (const p of pts) {
    total += p.len;
    for (const q of pts) {
      const along = Math.abs(p.at - q.at);
      if ((closed ? Math.min(along, acc - along) : along) < 250) continue; // closed: start and end are adjacent, so wrap the path distance
      if (d2(p, q) < 25 * 25) {
        overlap += p.len;
        break;
      }
    }
  }
  return total ? overlap / total : 0;
}

export function rankKey(gain: any, retrace: any) {
  return gain.area * (0.7 + 0.3 * Math.min(1, gain.newPct / 100)) * (1 - RETRACE_WEIGHT * retrace);
}

// Cut "there and back" excursions that don't pull their weight: an excursion is a
// stretch that returns to within 60 m of where it left the route. If the defog area
// it contributes per metre is under half of the route's overall rate, splice it out.
// That catches dead-end re-walks of covered ground (rate ≈ 0) and marginal wiggles,
// while keeping spurs INTO fog, which are ugly but often the point of the suggestion.
// Returns { coords, blockedM }: coords is the spliced geometry (null if nothing was
// cut) and blockedM the length of cuts wanted but skipped to respect minLenM. Loop
// callers regrow by that much and retry; p2p callers ignore it.
export function snipOldSpurs(coords: any, computeGain: any, minLenM: any) {
  const none = { coords: null, blockedM: 0 };
  if (!computeGain || coords.length < 10) return none;
  const routeGain = computeGain(coords);
  if (!routeGain || !(routeGain.area > 0)) return none;
  const { kx, ky } = metresPerDeg(coords[0][1]);
  const xy = coords.map((p: any) => ({ x: p[0] * kx, y: p[1] * ky }));
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++)
    cum.push((cum[i - 1] as number) + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
  const total = cum[cum.length - 1] as number;
  const routeEff = routeGain.area / total;
  const near = (i: any, j: any) => Math.hypot(xy[i].x - xy[j].x, xy[i].y - xy[j].y) < 60;
  const snips = [];
  let i = 0;
  while (i < coords.length - 1) {
    let found = -1;
    for (let j = coords.length - 1; j > i; j--) {
      // longest excursion from i first
      const ex = (cum[j] as number) - (cum[i] as number);
      if (ex < 200) break; // too short to matter (and shrinking further)
      if (ex > total * 0.45) continue; // never amputate the main loop body
      if (near(i, j)) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      i++;
      continue;
    }
    const without = coords.slice(0, i + 1).concat(coords.slice(found));
    const lost = routeGain.area - ((computeGain(without) || { area: 0 }).area || 0);
    const exLen = (cum[found] as number) - (cum[i] as number);
    if (lost / exLen < 0.5 * routeEff) snips.push({ i, j: found, cut: exLen });
    i = found;
  }
  // apply biggest cuts first, skip overlapping ones, never fall below minLenM
  snips.sort((a, b) => b.cut - a.cut);
  const applied: any[] = [];
  let remaining = total,
    blockedM = 0;
  for (const s of snips) {
    if (applied.some((a) => s.i < a.j && a.i < s.j)) continue;
    if (remaining - s.cut < minLenM) {
      blockedM += s.cut;
      continue;
    }
    applied.push(s);
    remaining -= s.cut;
  }
  if (!applied.length) return { coords: null, blockedM };
  applied.sort((a, b) => a.i - b.i);
  const out: any[] = [];
  let idx = 0;
  for (const s of applied) {
    out.push(...coords.slice(idx, s.i + 1));
    idx = s.j;
  }
  out.push(...coords.slice(idx));
  return { coords: out, blockedM };
}

// The same polyline without a vertex repeated right after itself.
export function dropRepeats(coords: any) {
  return coords.filter(
    (p: any, i: any) => i === 0 || p[0] !== coords[i - 1][0] || p[1] !== coords[i - 1][1],
  );
}

// Recompute length (and ascent/descent, where the coordinates carry elevation)
// after geometry surgery. The length stays this plain sum because ranking is tuned on it;
// the climb is the filtered one the route editor shows.
export function statsFromCoords(coords: any) {
  const { kx, ky } = metresPerDeg(coords[0][1]);
  const hasZ = coords[0].length > 2;
  let len = 0;
  for (let i = 1; i < coords.length; i++)
    len += Math.hypot(
      (coords[i][0] - coords[i - 1][0]) * kx,
      (coords[i][1] - coords[i - 1][1]) * ky,
    );
  const climb = hasZ ? Estimates.climb(coords.map((c: any) => c[2])) : null;
  return {
    coords,
    lenM: Math.round(len),
    ascent: climb ? climb.ascentM : undefined,
    descent: climb ? climb.descentM : undefined,
  };
}

// Editor pins for a routed candidate: its ends plus the street vertices its legs join at.
// A via pin may sit off the street, and a pin floating off the line would send the first
// edit's re-route through that point.
export function joinPins(route: any, from: any, to: any) {
  const joins = route.legs.slice(0, -1).map((l: any) => {
    const c = l.coords[l.coords.length - 1];
    return { lat: c[1], lng: c[0] };
  });
  return [from].concat(joins, [to]);
}

// Evenly spaced points along a snipped route's cleaned shape, used as adoption
// waypoints so a later re-route follows the same streets instead of re-growing the spur.
export function resampleMids(coords: any, n: any) {
  const { kx, ky } = metresPerDeg(coords[0][1]);
  const cum = [0];
  for (let i = 1; i < coords.length; i++)
    cum.push(
      (cum[i - 1] as number) +
        Math.hypot((coords[i][0] - coords[i - 1][0]) * kx, (coords[i][1] - coords[i - 1][1]) * ky),
    );
  const total = cum[cum.length - 1] as number;
  const mids = [];
  let k = 1;
  for (let t = 1; t <= n; t++) {
    const target = (total * t) / (n + 1);
    while (k < cum.length - 1 && (cum[k] as number) < target) k++;
    mids.push({ lat: coords[k][1], lng: coords[k][0] });
  }
  return mids;
}
