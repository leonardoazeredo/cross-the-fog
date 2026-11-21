// The run state of the suggestion tool: the held street graph and the wrapper around one run.
// Each function is a SuggestTool method, called with the tool as `this`; none touches the map.
import { GraphPlanner } from "./planner.ts";

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
