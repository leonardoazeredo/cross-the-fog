# Benchmark harness

Measures suggestion quality against real Fog of World data, headless under Node.
Needs a `Sync/` folder in the repo root (gitignored: it is personal location
history, never commit it).

```
node bench/characterize.js          # defog density maps; pick scenario centres
node bench/run.js [out] [filter]    # run the app's SuggestTool on bench/scenarios.js
node bench/overpass.js [filter]     # street-network context (total vs undefogged km)
```

- `lib/load.js` loads the real `app/src` parser + suggest code over a Leaflet stub,
  so benchmarks exercise the exact shipping algorithm.
- `lib/gain.js` replicates `computeGain`/`cellIsNew` from `main.js` (kept in sync by hand).
- Overpass responses are disk-cached in `bench/cache/` (gitignored): re-runs are free,
  reproducible, and kind to the public server. Delete the cache to re-measure live.
  Overpass answers 502 under load and the scenario then ends in the error state with
  `reason: "streets-fetch"`: wait a minute and rerun, only failed requests refetch.
  Suggestions never call BRouter; see CLAUDE.md for `bench/cache/brouter/`.
- Results land in `bench/out/<name>.json` (gitignored) with per-card metrics:
  defogged area, m² per metre, % new ground, overlap %, elongation
  (1 = round blob, 3+ = a proper thin "line" of a loop).

## Local routing

Suggestions route on the Overpass street graph in the browser (`app/src/router.js`).
The synthetic-graph tests need no `Sync/` and no network:

    for t in bench/*.test.js; do node $t; done

`planner-filter`, `streets-fetch`, `rect-query`, `router`, `p2p-reason`, `handoff`, `route-handoff`,
`retrace` and `compare` cover the usable-way filter, the Overpass query (its exact text, which
`bench/cache/` is keyed on) and how its reply is read, shortest paths, why a run fails, the Use
hand-off, the retrace ranking and compare.js itself. `scenarios.js` holds on-foot scenarios only:
compare.js skips the baseline's scenarios for the removed travel modes (`neustadt-bike-50k`,
`neustadt-p2p`) and scores the rest. `loop-fit` and `loop-wave` cover
the loop size search and the second wave.

Loop suggestions fit each compass square's size by a bracketed search (route length jumps where
a river or bridge sits, so one rescale is not enough). When fewer than three distinct directions
come back, a second wave runs in stages: leftover bearings as squares (they exist only when the
planner returned plans), then the first batch as narrow shapes, then as fat ones. Each stage runs
only while directions are short; with three directions in, nothing extra runs.

Acceptance against the BRouter baseline `bench/out/baseline-brouter.json` (keep a copy outside
`bench/out`; it can't be regenerated):

    node bench/run.js local            # twice: the first run pays for Overpass, the second is the timing
    node bench/compare.js bench/out/baseline-brouter.json bench/out/local.json

passes when the median, over the scenarios both still hold, of best-card area relative to the baseline is at
least 0.90, no route has a vertex gap over 700 m, and every scenario ran in 5 s. A loop over
30 km is declined with `reason: "too-long"` and shown as skipped.

`bench/out/reference-onfoot.json` holds the numbers of scenarios measured after the baseline was
saved (today `neustadt-striesen-walk-ab`, the on-foot A to B). Like the baseline it lives in gitignored
`bench/out/`, because the numbers come from your own `Sync/` and go stale as you walk. compare.js
reads it as its third argument and exits 2 when it is missing; it holds each scenario in it to the
same 0.90 ratio, gap and time limits on its own, so the loops' median is unchanged. Measure it, and
re-measure it after you have walked, with:

    node bench/run.js reference-onfoot walk-ab

## A to B wanted distance

`node bench/p2p-window.test.js` checks the window maths with no network or fog.
`node bench/p2p-target.js` runs the real `SuggestTool` against your fog
(`P2P_PINS="lat,lng;lat,lng"` picks the pins, default is the Dresden pair the removed
`neustadt-p2p` scenario used). One live run is enough: responses are cached. Overpass answers
502 when busy; a rerun after a few minutes refetches only what failed.

Observed on a real fog, ~4 km pins, 15% buffer unless noted, when the app still planned for
several travel modes (only the on-foot figures are kept here):
- Every case stays inside the promised window; 10x the fastest route falls back.
- Retracing (`p2p-target.js` prints `retr max`, the best card's m2/km and the fetch count per
  case). Before -> after the retrace work, on one warm cache:

    | case          | cards      | retr max   | best m2/km       | fallback    |
    |---------------|------------|------------|------------------|-------------|
    | untargeted    | 3 -> 3     | 0 -> 0%    | 25625 = 25625    | no          |
    | 1.5x          | 3 -> 3     | 13 -> 7%   | 22471 = 22471    | no          |
    | 1.5x 5%       | 3 -> 3     | 3 -> 3%    | 22637 = 22637    | no          |
    | 0.5x          | 3 -> 3     | 0 -> 0%    | 25625 = 25625    | no          |
    | 10x           | 3 -> 3     | 56 -> 56%  | 24134 -> 29434   | no          |

  - fetches per run: +0 to +2 (the re-route cap is 2). A card that retraces on purpose (a
    real dead end) is only discounted, never dropped; `RETRACE_WEIGHT` stays 0.5.
  - `overlapFrac(coords, false)` on a 16.3 km card (729 points): 0.7-0.9 ms per call.
  - Cards retracing >= 50% (10x, 56%) are still returned and labelled by `main.js` for
    retrace >= 10%.
