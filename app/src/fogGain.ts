// How much fog a line reveals. Everything that scores ground (the route stats, the suggestion planner's
// rewards, the street index's segment weights, the bench) asks it here. Pure: the fog, the grid size and
// the cell maths come in as arguments, so the page, the bench and the tests all run the same code.

/** Assumed half-width of the corridor Fog of World clears as you travel. */
export const DEFOG_HALF_M = 15;

const EARTH_CIRCUMFERENCE_M = 40075016.686;
// Leaflet's L.CRS.Earth radius: the route lengths here must be the numbers the map shows.
const EARTH_RADIUS_M = 6371e3;

export interface FogGainFogMap {
  isVisitedCell(cx: number, cy: number): boolean;
  hasFog(): boolean;
}

export interface FogGainDeps {
  fogMap: FogGainFogMap;
  /** Cells along one side of the world grid (FogParser.WORLD_CELLS). */
  worldCells: number;
  /** FogParser.lngLatToCell: fractional cell coordinates of a point. */
  lngLatToCell(lon: number, lat: number): { cx: number; cy: number };
}

/** A route as `[lon, lat]` points (a third element, a height, is ignored). */
export type Coords = ArrayLike<number>[];

export interface FogGain {
  cellMetersAt(lat: number): number;
  cellIsNew(lon: number, lat: number): boolean;
  corridorNewFrac(lon: number, lat: number): number;
  computeGain(coords: Coords): { area: number; newPct: number } | null;
  newness(latlng: { lat: number; lng: number }): number;
}

/** Great-circle metres between two points, the haversine Leaflet's `LatLng.distanceTo` computes, step for step. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a1 = lat1 * rad;
  const a2 = lat2 * rad;
  const sinDLat = Math.sin(((lat2 - lat1) * rad) / 2);
  const sinDLng = Math.sin(((lng2 - lng1) * rad) / 2);
  const h = sinDLat * sinDLat + Math.cos(a1) * Math.cos(a2) * sinDLng * sinDLng;
  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function createFogGain({ fogMap, worldCells, lngLatToCell }: FogGainDeps): FogGain {
  const cellMetersAt = (lat: number): number =>
    (EARTH_CIRCUMFERENCE_M / worldCells) * Math.cos((lat * Math.PI) / 180);

  // Is this point on genuinely new ground? True only if NO already-visited cell sits within the
  // ~DEFOG_HALF_M corridor, so weaving a cell off a road you've done doesn't read as new.
  function cellIsNew(lon: number, lat: number): boolean {
    const r = Math.max(1, Math.round(DEFOG_HALF_M / cellMetersAt(lat)));
    const c = lngLatToCell(lon, lat);
    const cx0 = Math.floor(c.cx);
    const cy0 = Math.floor(c.cy);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (fogMap.isVisitedCell(cx0 + dx, cy0 + dy)) return false;
      }
    }
    return true;
  }

  // Share of the ~DEFOG_HALF_M corridor stamp around a point that is still fogged. The street index
  // weights way segments by this, so its reward follows area.
  function corridorNewFrac(lon: number, lat: number): number {
    const r = Math.max(1, Math.round(DEFOG_HALF_M / cellMetersAt(lat)));
    const c = lngLatToCell(lon, lat);
    const cx0 = Math.floor(c.cx);
    const cy0 = Math.floor(c.cy);
    let fogged = 0;
    let total = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        total++;
        if (!fogMap.isVisitedCell(cx0 + dx, cy0 + dy)) fogged++;
      }
    }
    return fogged / total;
  }

  // What this route would defog: new area (cells in the clear-corridor) + the share of the route's
  // LENGTH that runs through never-visited ground.
  function computeGain(coords: Coords): { area: number; newPct: number } | null {
    if (!fogMap.hasFog() || coords.length < 2) return null;
    const mid = coords[Math.floor(coords.length / 2)] as ArrayLike<number>;
    const cellM = cellMetersAt(mid[1] as number);
    const r = Math.max(1, Math.round(DEFOG_HALF_M / cellM));
    const seen = new Set<number>();
    let newCells = 0;
    for (const p of coords) {
      const c = lngLatToCell(p[0] as number, p[1] as number);
      const cx0 = Math.floor(c.cx);
      const cy0 = Math.floor(c.cy);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          const key = cy * worldCells + cx;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!fogMap.isVisitedCell(cx, cy)) newCells++;
        }
      }
    }
    let total = 0;
    let newLen = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1] as ArrayLike<number>;
      const b = coords[i] as ArrayLike<number>;
      const d = distanceM(a[1] as number, a[0] as number, b[1] as number, b[0] as number);
      total += d;
      if (
        cellIsNew(
          ((a[0] as number) + (b[0] as number)) / 2,
          ((a[1] as number) + (b[1] as number)) / 2,
        )
      ) {
        newLen += d;
      }
    }
    return { area: newCells * cellM * cellM, newPct: total > 0 ? (100 * newLen) / total : 0 };
  }

  // Share of never-visited cells within ~100 m of a point, used to steer candidates away from ground
  // the user has already covered.
  function newness(latlng: { lat: number; lng: number }): number {
    if (!fogMap.hasFog()) return 1;
    const cellM = cellMetersAt(latlng.lat);
    const r = Math.min(15, Math.max(2, Math.round(100 / cellM)));
    const c = lngLatToCell(latlng.lng, latlng.lat);
    const cx0 = Math.floor(c.cx);
    const cy0 = Math.floor(c.cy);
    let visited = 0;
    let total = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        total++;
        if (fogMap.isVisitedCell(cx0 + dx, cy0 + dy)) visited++;
      }
    }
    return 1 - visited / total;
  }

  return { cellMetersAt, cellIsNew, corridorNewFrac, computeGain, newness };
}
