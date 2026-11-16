import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SqlDriver, SqlTx } from "../../../src/db/driver.js";
import { migrate, SCHEMA_VERSION } from "../../../src/db/schema.js";
import { createActivityStore } from "../../../src/history/activityStore.js";
import { deflateGpx, inflateGpx } from "../../../src/history/gpxBlob.js";
import { createRouteStore } from "../../../src/history/routeStore.js";
import { createNodeSqliteDriver } from "../../support/nodeSqliteDriver.js";
import { addOldRoutes, createV1Database, createV2Database } from "../../support/schemaV1.js";

const tables = (db: ReturnType<typeof createNodeSqliteDriver>) =>
  db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");

describe("migrate", () => {
  it("creates the three tables on an empty database and sets user_version 3", async () => {
    const db = createNodeSqliteDriver(":memory:");
    expect(await migrate(db)).toBe(3);
    expect((await tables(db)).map((t) => t.name)).toEqual(["activities", "blobs", "routes"]);
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(v?.user_version).toBe(3);
  });

  it("changes nothing when run again", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await migrate(db);
    await db.run("INSERT INTO blobs (kind, name, bytes) VALUES ('a', 'b', ?)", [
      new Uint8Array([1]),
    ]);
    expect(await migrate(db)).toBe(3);
    expect(await db.all("SELECT * FROM blobs")).toHaveLength(1);
  });

  it("refuses a database from a newer app", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer app.*update the app/);
  });

  it("rolls the migration back when a step fails", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await db.exec("CREATE TABLE routes (id TEXT)");
    await expect(migrate(db)).rejects.toThrow();
    expect((await tables(db)).map((t) => t.name)).toEqual(["routes"]);
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(v?.user_version).toBe(0);
  });
});

const GPX_A = `<gpx><trk><trkseg><trkpt lat="48.1" lon="11.5"><time>2026-03-01T10:00:00Z</time></trkpt></trkseg></trk></gpx>`;
const GPX_B = `<gpx>${'<trkpt lat="48.2" lon="11.6"/>'.repeat(200)} é ✓</gpx>`;
const IDS = ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"];

async function gpxColumns(db: SqlTx) {
  return (await db.all<{ name: string; type: string }>("PRAGMA table_info(activities)"))
    .filter((c) => c.name.startsWith("gpx"))
    .map((c) => `${c.name} ${c.type}`);
}

/** Fails the second activity copied into the new table, as a step that stops midway would. */
function failingOnSecondCopy(db: SqlDriver): SqlDriver {
  let copies = 0;
  const wrapTx = (tx: SqlTx): SqlTx => ({
    ...tx,
    async run(sql, params) {
      if (/INSERT INTO activities_v2/.test(sql) && ++copies === 2) throw new Error("stopped");
      return tx.run(sql, params);
    },
  });
  return { ...db, transaction: (fn) => db.transaction((tx) => fn(wrapTx(tx))) };
}

describe("migration 2: the GPX deflated at rest", () => {
  it("deflates the GPX of every schema-1 activity and keeps the rest of the row", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await createV1Database(db, [
      { id: IDS[0] as string, gpx: GPX_A },
      { id: IDS[1] as string, gpx: GPX_B },
    ]);
    expect(await migrate(db)).toBe(3);
    expect(await gpxColumns(db)).toEqual(["gpx_deflated BLOB"]);
    const rows = await db.all<{ id: string; gpx_deflated: Uint8Array }>(
      "SELECT id, gpx_deflated FROM activities ORDER BY id",
    );
    expect(rows.map((r) => inflateGpx(r.gpx_deflated))).toEqual([GPX_A, GPX_B]);
    expect(rows[1]?.gpx_deflated.length).toBeLessThan(GPX_B.length / 4);
    const store = createActivityStore(db);
    expect(await store.gpx(IDS[1] as string)).toBe(GPX_B);
    expect(await store.get(IDS[0] as string)).toMatchObject({
      startedAt: "2026-03-01T10:00:00Z",
      endedAt: "2026-03-01T11:00:00Z",
      receivedAt: "2026-03-01T11:05:00Z",
      stats: { durationS: 3600 },
      track: [{ t: 0, lat: 48.1, lon: 11.5 }],
      encoderVersion: "enc-1",
    });
  });

  it("migrates a schema-1 database with no activities", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await createV1Database(db);
    expect(await migrate(db)).toBe(3);
    expect(await gpxColumns(db)).toEqual(["gpx_deflated BLOB"]);
    expect(await db.all("SELECT * FROM activities")).toEqual([]);
  });

  it("leaves schema 1 whole when it stops midway, and the next open migrates it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crossfog-migrate-"));
    try {
      const path = join(dir, "h.db");
      const first = createNodeSqliteDriver(path);
      await createV1Database(first, [
        { id: IDS[0] as string, gpx: GPX_A },
        { id: IDS[1] as string, gpx: GPX_B },
      ]);
      await expect(migrate(failingOnSecondCopy(first))).rejects.toThrow("stopped");
      await first.close();

      const again = createNodeSqliteDriver(path);
      const [v] = await again.all<{ user_version: number }>("PRAGMA user_version");
      expect(v?.user_version).toBe(1);
      expect(await gpxColumns(again)).toEqual(["gpx TEXT"]);
      expect((await tables(again)).map((t) => t.name)).toEqual(["activities", "blobs", "routes"]);
      expect(await migrate(again)).toBe(3);
      expect(await createActivityStore(again).gpx(IDS[1] as string)).toBe(GPX_B);
      await again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers from a process killed midway through it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crossfog-migrate-"));
    try {
      const path = join(dir, "h.db");
      const setup = createNodeSqliteDriver(path);
      await createV1Database(setup, [
        { id: IDS[0] as string, gpx: GPX_A },
        { id: IDS[1] as string, gpx: GPX_B },
      ]);
      await setup.close();

      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", join(import.meta.dirname, "../../support/killMidMigration.ts"), path],
        { encoding: "utf-8" },
      );
      expect(child.signal, child.stderr).toBe("SIGKILL");

      const again = createNodeSqliteDriver(path);
      const [v] = await again.all<{ user_version: number }>("PRAGMA user_version");
      expect(v?.user_version).toBe(1);
      expect(await migrate(again)).toBe(SCHEMA_VERSION);
      expect(await createActivityStore(again).gpx(IDS[0] as string)).toBe(GPX_A);
      expect(await createActivityStore(again).gpx(IDS[1] as string)).toBe(GPX_B);
      await again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const ROUTE_IDS = ["b0000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000002"];

const columns = async (db: SqlTx, table: string) =>
  (await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);

const withoutTravelMode = (rows: Record<string, unknown>[]) =>
  rows.map(({ travel_mode: _mode, ...rest }) => rest);

describe("migration 3: no travel mode", () => {
  it("drops the column from a schema-2 database and keeps every row and every other column", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await createV2Database(db, [
      { id: IDS[0] as string, gpxDeflated: deflateGpx(GPX_A), routeId: ROUTE_IDS[0] as string },
      { id: IDS[1] as string, gpxDeflated: deflateGpx(GPX_B) },
    ]);
    await addOldRoutes(db, [
      { id: ROUTE_IDS[0] as string, sentAt: "2026-03-01T09:30:00Z" },
      { id: ROUTE_IDS[1] as string },
    ]);
    const activities = await db.all<Record<string, unknown>>(
      "SELECT * FROM activities ORDER BY id",
    );
    const routes = await db.all<Record<string, unknown>>("SELECT * FROM routes ORDER BY id");

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await columns(db, "activities")).not.toContain("travel_mode");
    expect(await columns(db, "routes")).not.toContain("travel_mode");
    expect(await db.all("SELECT * FROM activities ORDER BY id")).toEqual(
      withoutTravelMode(activities),
    );
    expect(await db.all("SELECT * FROM routes ORDER BY id")).toEqual(withoutTravelMode(routes));

    const store = createActivityStore(db);
    expect((await store.list()).map((a) => a.id).sort()).toEqual(IDS);
    expect(await store.get(IDS[0] as string)).toEqual({
      id: IDS[0],
      startedAt: "2026-03-01T10:00:00Z",
      endedAt: "2026-03-01T11:00:00Z",
      routeId: ROUTE_IDS[0],
      stats: { durationS: 3600, distanceM: 4200 },
      track: [{ t: 0, lat: 48.1, lon: 11.5 }],
      receivedAt: "2026-03-01T11:05:00Z",
      encoderVersion: "enc-1",
    });
    expect(await store.gpx(IDS[1] as string)).toBe(GPX_B);
    const sent = await createRouteStore(db).get(ROUTE_IDS[0] as string);
    expect(sent).toMatchObject({
      mode: "loop",
      targetDistanceM: 5000,
      sentAt: "2026-03-01T09:30:00Z",
    });
    expect(sent).not.toHaveProperty("travelMode");
    expect((await createRouteStore(db).list()).map((r) => r.id).sort()).toEqual(ROUTE_IDS);
  });

  it("takes a schema-1 database through both steps with its activities and routes", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await createV1Database(db, [{ id: IDS[0] as string, gpx: GPX_A }]);
    await addOldRoutes(db, [{ id: ROUTE_IDS[0] as string }]);
    const routes = await db.all<Record<string, unknown>>("SELECT * FROM routes");

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await db.all("SELECT * FROM routes")).toEqual(withoutTravelMode(routes));
    expect(await columns(db, "activities")).toEqual([
      "id",
      "started_at",
      "ended_at",
      "route_id",
      "gpx_deflated",
      "track_json",
      "stats_json",
      "received_at",
      "encoder_version",
    ]);
    const store = createActivityStore(db);
    expect(await store.gpx(IDS[0] as string)).toBe(GPX_A);
    expect(await store.get(IDS[0] as string)).toMatchObject({
      startedAt: "2026-03-01T10:00:00Z",
      stats: { durationS: 3600 },
      encoderVersion: "enc-1",
    });
  });

  it("leaves schema 2 whole when it stops between the two tables", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await createV2Database(db, [{ id: IDS[0] as string, gpxDeflated: deflateGpx(GPX_A) }]);
    await addOldRoutes(db, [{ id: ROUTE_IDS[0] as string }]);
    const stopping: SqlDriver = {
      ...db,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            ...tx,
            async exec(sql) {
              if (!/DROP COLUMN/.test(sql)) return tx.exec(sql);
              await tx.exec("ALTER TABLE activities DROP COLUMN travel_mode");
              throw new Error("stopped");
            },
          }),
        ),
    };
    await expect(migrate(stopping)).rejects.toThrow("stopped");
    const [v] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(v?.user_version).toBe(2);
    expect(await columns(db, "activities")).toContain("travel_mode");
    expect(await columns(db, "routes")).toContain("travel_mode");
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await createActivityStore(db).gpx(IDS[0] as string)).toBe(GPX_A);
  });
});

describe("transaction", () => {
  it("rolls back when the callback throws", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await db.exec("CREATE TABLE t (x INTEGER)");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t VALUES (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.all("SELECT * FROM t")).toEqual([]);
  });

  it("commits and returns the callback's value", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await db.exec("CREATE TABLE t (x INTEGER)");
    const out = await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t VALUES (1)");
      return "done";
    });
    expect(out).toBe("done");
    expect(await db.all("SELECT * FROM t")).toHaveLength(1);
  });

  it("runs overlapping transactions one after the other", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await db.exec("CREATE TABLE t (x INTEGER)");
    await Promise.all(
      [1, 2, 3].map((n) =>
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO t VALUES (?)", [n]);
          await Promise.resolve();
        }),
      ),
    );
    expect(await db.all("SELECT x FROM t ORDER BY x")).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
  });
});
