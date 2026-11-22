// Overpass answers for the e2e stand-in: the streets of a regular grid, the same everywhere, so a route or a suggestion
// can be planned over any ground the fixture fog shows. Made up, never derived from a place or a location history.

export interface Box {
  s: number;
  w: number;
  n: number;
  e: number;
}

/** Grid spacing in degrees: about 111 m north-south and 100 m east-west at mid latitudes. */
const LAT_STEP = 0.001;
const LON_STEP = 0.0015;

/** The boxes of a rectQuery, read from its `(s,w,n,e)` groups in the order they appear, each once. */
export function boxesOf(query: string): Box[] {
  const seen = new Set<string>();
  const boxes: Box[] = [];
  for (const m of query.matchAll(
    /\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/g,
  )) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    boxes.push({ s: Number(m[1]), w: Number(m[2]), n: Number(m[3]), e: Number(m[4]) });
  }
  return boxes;
}

const inside = (b: Box, lat: number, lon: number) =>
  lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

// A way is one grid segment, so ids and node ids depend on the segment alone and two requests that both reach it
// name it the same. Overpass hands over a whole way when any node lies in the box, which "either end inside" copies.
const nodeId = (i: number, j: number) => 1_000_000_000 + (i + 100_000) * 200_001 + (j + 100_000);
const wayId = (i: number, j: number, horizontal: boolean) =>
  2 * (nodeId(i, j) % 1_000_000_000_000) + (horizontal ? 1 : 0);

export interface StandInWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: Array<{ lat: number; lon: number }>;
}

export function waysIn(boxes: Box[]): StandInWay[] {
  const ways = new Map<number, StandInWay>();
  for (const b of boxes) {
    // One step beyond the box on every side, so a segment with one end inside is found from either end.
    for (let i = Math.floor(b.s / LAT_STEP) - 1; i <= Math.ceil(b.n / LAT_STEP) + 1; i++) {
      for (let j = Math.floor(b.w / LON_STEP) - 1; j <= Math.ceil(b.e / LON_STEP) + 1; j++) {
        const here = { lat: i * LAT_STEP, lon: j * LON_STEP };
        const east = { lat: here.lat, lon: (j + 1) * LON_STEP };
        const north = { lat: (i + 1) * LAT_STEP, lon: here.lon };
        if (inside(b, here.lat, here.lon) || inside(b, east.lat, east.lon)) {
          ways.set(wayId(i, j, true), {
            type: "way",
            id: wayId(i, j, true),
            nodes: [nodeId(i, j), nodeId(i, j + 1)],
            geometry: [here, east],
          });
        }
        if (inside(b, here.lat, here.lon) || inside(b, north.lat, north.lon)) {
          ways.set(wayId(i, j, false), {
            type: "way",
            id: wayId(i, j, false),
            nodes: [nodeId(i, j), nodeId(i + 1, j)],
            geometry: [here, north],
          });
        }
      }
    }
  }
  return [...ways.values()];
}

/** The body of an Overpass answer to a rectQuery: the ways, then the count that closes it. */
export function answerTo(query: string): { elements: unknown[] } {
  const ways = waysIn(boxesOf(query));
  return {
    elements: [
      ...ways,
      {
        type: "count",
        id: 0,
        tags: { nodes: "0", ways: String(ways.length), relations: "0", total: String(ways.length) },
      },
    ],
  };
}
