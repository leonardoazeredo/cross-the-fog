// "Surprise me" routing: suggest up to 3 routes that maximise defogging.
// Two modes: point-to-point (A → B) and loop (start + target distance).
// Candidates are routed locally over the street graph (fog-seeking via-points /
// fog-biased loop bearings, plus the graph planner's walks) and every candidate is
// scored client-side with the caller's defog-gain function. The fog itself never
// leaves the device; only the bounding box of the streets needed goes to Overpass.

import {
  bearingApart,
  joinPins,
  loopBearingOf,
  overlapFrac,
  p2pCandidates,
  p2pWindow,
  RETRACE_WEIGHT,
  rankKey,
  resampleMids,
  snipOldSpurs,
  splitRuns,
  statsFromCoords,
} from "./suggestPure.ts";
import {
  _cancel,
  _diversify,
  _graph,
  _holdGraph,
  _loadStreets,
  _loopBearings,
  _loopVias,
  _loopViasTri,
  _newAreaM2,
  _newness,
  _noRoute,
  _pickVias,
  _pool,
  _rank,
  _releaseGraph,
  _rerouteReturn,
  _route,
  _snapToNewStreets,
  _suggestLoop,
  _suggestP2P,
  _viaCandidates,
  _viaPoint,
  createEngine,
  FIT_ROUTES,
  fitLoopSize,
  type Self,
  streetGraph,
  suggest,
} from "./suggestRun.ts";

// What the tool reads from the page, looked up on the host when it runs, never at load: Leaflet's `L` (markers, icons,
// polylines, bounds) and `matchMedia`. pageGlobals.ts binds the page's own object.
export interface SuggestHost {
  // the surface this file uses is read through `leaflet()`
  L?: object;
  matchMedia?: (query: string) => { matches: boolean };
}

let host: SuggestHost | null = null;
export function bindSuggestHost(h: SuggestHost): void {
  host = h;
}

// A bare `L` threw this when the page had no Leaflet.
// biome-ignore lint/suspicious/noExplicitAny: see SuggestHost
function leaflet(): any {
  if (!host?.L) throw new ReferenceError("L is not defined");
  return host.L as any;
}

// Same neon family as the drawn route (#ff2d55): red · pink · orange, which pops against
// the fog, deliberately far from the blue/purple/slate fog swatches.
const COLORS = ["#ff2d55", "#ff4fa3", "#ff8c2d"];

function pinIcon(cls: any, label: any) {
  const COARSE = !!(host?.matchMedia && host.matchMedia("(pointer: coarse)").matches);
  const sz = COARSE ? 26 : 18;
  return leaflet().divIcon({
    className: "",
    html: '<div class="wp ' + cls + '">' + label + "</div>",
    iconSize: [sz, sz],
    iconAnchor: [sz / 2, sz / 2],
  });
}

function SuggestTool(this: Self, map: any, opts: any) {
  this.map = map;
  this.engine = opts.engine || createEngine(opts);
  this.computeGain = opts.computeGain; // (coords) -> { area, newPct } | null
  this.newness = opts.newness || null; // ({lat, lng}) -> share of never-visited cells within ~100 m; FogGain's, over this.fogMap, when not given
  this.isNew = opts.isNew || null; // (lon,lat) -> true if the point is new ground
  this.onPoints = opts.onPoints || null; // (count) -> UI update
  this.onResults = opts.onResults || null; // (state|null) -> render progress/cards
  this.mode = "p2p"; // "p2p" | "loop"
  this.a = null;
  this.b = null; // start / end markers (loop uses only a)
  this.active = false;
  this.results = []; // top candidates of the last run
  this.lines = []; // their preview polylines
  this.selected = -1;
  this._onClick = (e: any) => this._place(e.latlng);
}

// The run state lives on the engine; the tool's own functions still read it as fields of `this`.
for (const field of ["streets", "fogMap", "_runId", "_planner", "_hold"])
  Object.defineProperty(SuggestTool.prototype, field, {
    get(this: Self) {
      return this.engine[field];
    },
    set(this: Self, v: any) {
      this.engine[field] = v;
    },
  });

SuggestTool.prototype.streetGraph = streetGraph;
SuggestTool.prototype._holdGraph = _holdGraph;
SuggestTool.prototype._releaseGraph = _releaseGraph;
SuggestTool.prototype._cancel = _cancel;
SuggestTool.prototype._graph = _graph;
SuggestTool.prototype.suggest = suggest;
SuggestTool.prototype._loadStreets = _loadStreets;
SuggestTool.prototype._route = _route;
SuggestTool.prototype._noRoute = _noRoute;
SuggestTool.prototype._rerouteReturn = _rerouteReturn;
SuggestTool.prototype._newness = _newness;
SuggestTool.prototype._newAreaM2 = _newAreaM2;
SuggestTool.prototype._snapToNewStreets = _snapToNewStreets;
SuggestTool.prototype._pool = _pool;
SuggestTool.prototype._diversify = _diversify;
SuggestTool.prototype._rank = _rank;
SuggestTool.prototype._viaPoint = _viaPoint;
SuggestTool.prototype._viaCandidates = _viaCandidates;
SuggestTool.prototype._pickVias = _pickVias;
SuggestTool.prototype._suggestP2P = _suggestP2P;
SuggestTool.prototype._loopBearings = _loopBearings;
SuggestTool.prototype._loopVias = _loopVias;
SuggestTool.prototype._loopViasTri = _loopViasTri;
SuggestTool.prototype._suggestLoop = _suggestLoop;

SuggestTool.prototype.setActive = function (this: Self, on: any) {
  this.active = on;
  if (on) this.map.on("click", this._onClick);
  else this.map.off("click", this._onClick);
  this.map.getContainer().style.cursor = on ? "crosshair" : "";
};

SuggestTool.prototype.setMode = function (this: Self, m: any) {
  if (this.mode === m) return;
  this.mode = m;
  if (m === "loop" && this.b) {
    this.map.removeLayer(this.b);
    this.b = null;
  }
  this.clearResults();
  if (this.onPoints) this.onPoints(this.pointCount());
};

SuggestTool.prototype.pointCount = function (this: Self) {
  return (this.a ? 1 : 0) + (this.b ? 1 : 0);
};
SuggestTool.prototype.pointsNeeded = function (this: Self) {
  return this.mode === "loop" ? 1 : 2;
};

SuggestTool.prototype._place = function (this: Self, latlng: any) {
  if (this.a && (this.mode === "loop" || this.b)) return; // all pins set, drag to adjust
  const isA = !this.a;
  const m = leaflet()
    .marker(latlng, { draggable: true, icon: pinIcon(isA ? "sugA" : "sugB", isA ? "A" : "B") })
    .addTo(this.map);
  m.on("dragend", () => this.clearResults());
  m.on("click", (e: any) => {
    leaflet().DomEvent.stop(e);
    this._removePin(m);
  });
  if (isA) this.a = m;
  else this.b = m;
  this.clearResults();
  if (this.onPoints) this.onPoints(this.pointCount());
};

SuggestTool.prototype._removePin = function (this: Self, m: any) {
  this.map.removeLayer(m);
  if (this.a === m) this.a = null;
  else if (this.b === m) this.b = null;
  this.clearResults();
  if (this.onPoints) this.onPoints(this.pointCount());
};

SuggestTool.prototype.reset = function (this: Self) {
  if (this.a) this.map.removeLayer(this.a);
  if (this.b) this.map.removeLayer(this.b);
  this.a = this.b = null;
  this.clearResults();
  if (this.onPoints) this.onPoints(0);
};

SuggestTool.prototype.clearResults = function (this: Self) {
  this._cancel();
  this._clearScreen();
};

// Kept apart from _cancel so the run state can be cancelled without a map: a run only needs its id
// bumped and its graph released, while the layers and the page's cards exist only on the screen.
SuggestTool.prototype._clearScreen = function (this: Self) {
  this.lines.forEach((l: any) => {
    this.map.removeLayer(l.solid);
    this.map.removeLayer(l.dashed);
  });
  this.lines = [];
  this.results = [];
  this.selected = -1;
  if (this.onResults) this.onResults(null);
};

SuggestTool.prototype.select = function (this: Self, i: any) {
  this.selected = i;
  this.lines.forEach((l: any, k: any) => {
    const sel = k === i;
    l.solid.setStyle({ weight: sel ? 6 : 4, opacity: sel ? 0.95 : 0.65 });
    l.dashed.setStyle({ weight: sel ? 4.5 : 3, opacity: sel ? 0.9 : 0.55 });
  });
};

// Candidate i for the ordinary route editor: the pins to show and the exact
// geometry that was previewed.
SuggestTool.prototype.adopt = function (this: Self, i: any) {
  const c = this.results[i];
  if (!c) return null;
  const out = { wps: c.adoptWps.slice(), coords: c.r.coords };
  this.clearResults();
  return out;
};

// The screen half, apart from _rank so ranking needs no map. The best option is selected before the
// cards are emitted because the page reads `selected` when it renders them.
SuggestTool.prototype._show = function (this: Self, extra: any) {
  const emit = (s: any) => {
    if (this.onResults) this.onResults(s);
  };
  this.lines = this.results.map((c: any, i: any) => {
    const runs = splitRuns(c.r.coords, this.isNew);
    return {
      solid: leaflet()
        .polyline(runs.newRuns, { color: COLORS[i], weight: 4, opacity: 0.65 })
        .addTo(this.map),
      dashed: leaflet()
        .polyline(runs.oldRuns, {
          color: COLORS[i],
          weight: 3,
          opacity: 0.55,
          dashArray: "2 8",
          lineCap: "round",
        })
        .addTo(this.map),
    };
  });
  if (this.lines.length) {
    let bounds: any = null;
    this.results.forEach((c: any) => {
      c.r.coords.forEach((p: any) => {
        bounds = bounds
          ? bounds.extend([p[1], p[0]])
          : leaflet().latLngBounds([p[1], p[0]], [p[1], p[0]]);
      });
    });
    this.map.fitBounds(bounds, { padding: [30, 30] });
    this.select(0); // best option pre-selected before the cards render
  }
  const refKm = extra.baseKm != null ? extra.baseKm : extra.targetKm;
  emit(
    Object.assign({}, extra, {
      list: this.results.map((c: any, i: any) => ({
        color: COLORS[i],
        km: c.r.lenM / 1000,
        deltaKm: c.r.lenM / 1000 - refKm,
        ascent: c.r.ascent,
        descent: c.r.descent,
        area: c.gain.area,
        newPct: c.gain.newPct,
        retracePct: c.retrace != null ? Math.round(c.retrace * 100) : undefined,
        isBase: !!c.isBase,
      })),
    }),
  );
};

// Ends a run: ranks its candidates, then draws and presents them unless the run was replaced.
SuggestTool.prototype._finish = function (this: Self, runId: any, cands: any, extra: any, S?: any) {
  if (runId !== this._runId) return;
  const ranked = this._rank(cands, extra, S);
  if (ranked.empty) {
    if (this.onResults) this.onResults(ranked.empty);
    return;
  }
  this.results = ranked.results;
  this._show(extra);
};

SuggestTool._internals = {
  loopBearingOf,
  bearingApart,
  snipOldSpurs,
  overlapFrac,
  rankKey,
  RETRACE_WEIGHT,
  statsFromCoords,
  joinPins,
  resampleMids,
  p2pWindow,
  p2pCandidates,
  fitLoopSize,
  FIT_ROUTES,
}; // for tests

// The constructor itself, not a copy: main.js and the tests build it with `new`.
export { SuggestTool };
