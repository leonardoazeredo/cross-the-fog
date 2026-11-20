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
import {
  createDownload,
  downloadError,
  downloadFacts,
  type EnsureOptions,
  isDownloadError,
  isSuperseded,
  type Outcome,
  overpassFetch,
  type RunSettings,
  rectQuery,
  type Source,
  type StreetDownload,
  sortOutcome,
  splitAnswer,
} from "./streetDownload.ts";
import {
  nearestFirst,
  type Rect,
  TILE_DEG,
  type Tile,
  type TileAnswer,
  tileBounds,
  tileId,
  tileOf,
  tilesCovering,
  tilesOf,
} from "./streetGrid.ts";
import {
  bindStreetsHost,
  type StoreOptions,
  StreetStore,
  type StreetStoreSelf,
  type StreetsHost,
} from "./streetStore.ts";

export { bindStreetsHost, type StreetsHost };

// The street index: a street store (streetStore.ts) and a street download (streetDownload.ts) on one
// object, so a caller reads the ways, the version and the scores off the same instance that
// ensureRects fills.
interface StreetIndexOptions extends StoreOptions {
  fetchStreets?: Source;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  every?: (fn: () => void, ms: number) => () => void;
}
// The index as its methods see it: `this` in each prototype function below.
interface Self extends StreetStoreSelf, RunSettings {
  download: StreetDownload;
  ensureRects(rects: Rect[], opts?: EnsureOptions): Promise<unknown>;
}

function StreetIndex(this: Self, opts: StreetIndexOptions) {
  StreetStore.call(this, opts);
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
  // the download reaches the store only through these five calls, looked up on the index each time so a
  // test or a caller that replaces a method on it is heard
  this.download = createDownload(this, {
    holds: (t: Tile) => this._holds(t),
    anchor: (lat: number) => this._anchor(lat),
    read: (answer: TileAnswer, from: Tile) => this._read(answer, from),
    cover: (tiles: Tile[]) => this._cover(tiles),
    protect: (under: Set<string>, holdAs?: string) => this._protect(under, holdAs),
  });
}
Object.setPrototypeOf(StreetIndex.prototype, StreetStore.prototype);

StreetIndex.prototype.ensureRects = function (this: Self, rects: Rect[], opts?: EnsureOptions) {
  return this.download.ensureRects(rects, opts);
};

// ensureRects, sorted into an Outcome and never rejecting; goes through this.ensureRects so a
// replacement on the instance is heard, as everywhere else the index looks its own methods up.
StreetIndex.prototype.outcome = function (
  this: Self,
  rects: Rect[],
  opts?: EnsureOptions,
): Promise<Outcome> {
  return sortOutcome(() => this.ensureRects(rects, opts));
};

StreetIndex.TILE_DEG = TILE_DEG;
StreetIndex.tileOf = tileOf;
StreetIndex.tilesCovering = tilesCovering;
StreetIndex.tilesOf = tilesOf;
StreetIndex.tileBounds = tileBounds;
StreetIndex.tileId = tileId;
StreetIndex.nearestFirst = nearestFirst;
StreetIndex.rectQuery = rectQuery;
StreetIndex.splitAnswer = splitAnswer;
// The query and the answer split are read off the constructor when a request is built or answered, so a
// caller that replaces them there is heard.
StreetIndex.overpassFetch = (
  tiles: Tile[],
  onTile?: (t: Tile, answer: TileAnswer | undefined, via?: { cached?: boolean }) => void,
  opts?: Parameters<typeof overpassFetch>[2],
) =>
  overpassFetch(tiles, onTile, opts, {
    rectQuery: (boxes) => StreetIndex.rectQuery(boxes),
    splitAnswer: (gj, ts) => StreetIndex.splitAnswer(gj, ts),
  });
StreetIndex.downloadError = downloadError;
StreetIndex.isDownloadError = isDownloadError;
StreetIndex.isSuperseded = isSuperseded;
StreetIndex.downloadFacts = downloadFacts;

// The constructor itself, not a copy: other files build it with `new` and call its statics (`overpassFetch`,
// `downloadError`, `isSuperseded`, `tileId`...), and the tests read its fields.
export { StreetIndex };
