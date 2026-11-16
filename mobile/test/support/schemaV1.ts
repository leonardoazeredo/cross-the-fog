import type { SqlTx } from "../../src/db/driver.js";

// Frozen copies of schemas 1 (the first release's, with the GPX as text) and 2 (the GPX deflated,
// still with a travel mode), so tests can build the databases and backups those releases left on
// phones. They never follow MIGRATIONS.
const V1 = `CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    travel_mode TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    route_id TEXT,
    gpx TEXT NOT NULL,
    track_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    received_at TEXT NOT NULL,
    encoder_version TEXT NOT NULL
  );
  CREATE TABLE routes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    travel_mode TEXT NOT NULL,
    target_distance_m REAL,
    waypoints_json TEXT NOT NULL,
    coords_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    gpx TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE TABLE blobs (
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (kind, name)
  );
  PRAGMA user_version = 1;`;

export interface V1Activity {
  id: string;
  gpx: string;
  startedAt?: string;
}

/**
 * Builds a schema-1 database holding `activities`, each with the GPX stored as text. Columns
 * other than id, gpx and started_at hold fixed values, which schema.test.ts asserts after the migration.
 */
export async function createV1Database(db: SqlTx, activities: V1Activity[] = []): Promise<void> {
  await db.exec(V1);
  for (const a of activities) {
    await db.run(
      `INSERT INTO activities
         (id, travel_mode, started_at, ended_at, route_id, gpx, track_json, stats_json, received_at, encoder_version)
       VALUES (?, 'walk', ?, '2026-03-01T11:00:00Z', NULL, ?, '[{"t":0,"lat":48.1,"lon":11.5}]', '{"durationS":3600}', '2026-03-01T11:05:00Z', 'enc-1')`,
      [a.id, a.startedAt ?? "2026-03-01T10:00:00Z", a.gpx],
    );
  }
}

const V2 = `CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    travel_mode TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    route_id TEXT,
    gpx_deflated BLOB NOT NULL,
    track_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    received_at TEXT NOT NULL,
    encoder_version TEXT NOT NULL
  );
  CREATE TABLE routes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    travel_mode TEXT NOT NULL,
    target_distance_m REAL,
    waypoints_json TEXT NOT NULL,
    coords_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    gpx TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE TABLE blobs (
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (kind, name)
  );
  PRAGMA user_version = 2;`;

export interface V2Activity {
  id: string;
  gpxDeflated: Uint8Array;
  routeId?: string;
}

/**
 * Builds a schema-2 database holding `activities`, each with its GPX already deflated. Columns other
 * than id, gpx_deflated and route_id hold fixed values.
 */
export async function createV2Database(db: SqlTx, activities: V2Activity[] = []): Promise<void> {
  await db.exec(V2);
  for (const a of activities) {
    await db.run(
      `INSERT INTO activities
         (id, travel_mode, started_at, ended_at, route_id, gpx_deflated, track_json, stats_json, received_at, encoder_version)
       VALUES (?, 'walk', '2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z', ?, ?, '[{"t":0,"lat":48.1,"lon":11.5}]', '{"durationS":3600,"distanceM":4200}', '2026-03-01T11:05:00Z', 'enc-1')`,
      [a.id, a.routeId ?? null, a.gpxDeflated],
    );
  }
}

export interface OldRoute {
  id: string;
  sentAt?: string;
}

/** Adds routes to a schema-1 or schema-2 database; columns other than id and sent_at hold fixed values. */
export async function addOldRoutes(db: SqlTx, routes: OldRoute[]): Promise<void> {
  for (const r of routes) {
    await db.run(
      `INSERT INTO routes
         (id, created_at, mode, travel_mode, target_distance_m, waypoints_json, coords_json, stats_json, gpx, sent_at)
       VALUES (?, '2026-03-01T09:00:00Z', 'loop', 'hiking-mountain', 5000,
               '[{"lat":48.1,"lng":11.5},{"lat":48.11,"lng":11.51}]', '[[11.5,48.1,520],[11.51,48.11]]',
               '{"distanceM":5100,"seconds":null,"ascentM":null,"descentM":null}', '<gpx/>', ?)`,
      [r.id, r.sentAt ?? null],
    );
  }
}
