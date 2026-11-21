import { describe, expect, it } from "vitest";
import { migrate } from "../../../src/db/schema.js";
import { createMemoryRouteStore } from "../../../src/history/memoryStores.js";
import { createRouteStore } from "../../../src/history/routeStore.js";
import { type RouteStore, UnknownRouteError } from "../../../src/history/types.js";
import { createNodeSqliteDriver } from "../../support/nodeSqliteDriver.js";
import { route } from "./fixtures.js";

const NOW = "2026-03-02T12:00:00.000Z";
const impls: [string, () => Promise<RouteStore>][] = [
  [
    "sqlite",
    async () => {
      const db = createNodeSqliteDriver(":memory:");
      await migrate(db);
      return createRouteStore(db, { now: () => new Date(NOW) });
    },
  ],
  ["memory", async () => createMemoryRouteStore({ now: () => new Date(NOW) })],
];

describe.each(impls)("route store (%s)", (_name, make) => {
  it("saves a route and gives it back whole, nulls and optional fields included", async () => {
    const s = await make();
    await s.save(route());
    expect(await s.get(route().id)).toEqual(route());
    await s.save(
      route({
        id: "44444444-4444-4444-8444-444444444444",
        targetDistanceM: undefined,
        mode: "p2p",
      }),
    );
    expect((await s.get("44444444-4444-4444-8444-444444444444"))?.targetDistanceM).toBeUndefined();
  });

  it("returns null for an unknown id", async () => {
    expect(await (await make()).get("33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("lists newest first without geometry or file", async () => {
    const s = await make();
    await s.save(
      route({ id: "44444444-4444-4444-8444-444444444441", createdAt: "2026-01-01T00:00:00Z" }),
    );
    await s.save(
      route({ id: "44444444-4444-4444-8444-444444444442", createdAt: "2026-02-01T00:00:00Z" }),
    );
    const list = await s.list();
    expect(list.map((r) => r.id.slice(-1))).toEqual(["2", "1"]);
    expect(list[0]).not.toHaveProperty("coords");
    expect(list[0]).not.toHaveProperty("gpx");
    expect(list[0]).not.toHaveProperty("waypoints");
    expect(list[0]?.stats.seconds).toBeNull();
  });

  it("marks a route sent", async () => {
    const s = await make();
    await s.save(route());
    expect((await s.get(route().id))?.sentAt).toBeUndefined();
    await s.markSent(route().id);
    expect((await s.get(route().id))?.sentAt).toBe(NOW);
    expect((await s.list())[0]?.sentAt).toBe(NOW);
  });

  it("refuses to mark an unknown route sent", async () => {
    const err = await (await make()).markSent(route().id).catch((e) => e);
    expect(err).toBeInstanceOf(UnknownRouteError);
    expect(err.message).toBe("unknown route");
    expect(err.id).toBe(route().id);
  });

  it("clears sentAt when the route is saved again", async () => {
    const s = await make();
    await s.save(route());
    await s.markSent(route().id);
    await s.save(route({ gpx: "edited" }));
    const got = await s.get(route().id);
    expect(got?.sentAt).toBeUndefined();
    expect(got?.gpx).toBe("edited");
  });

  it("drops a sentAt that comes in with the route", async () => {
    const s = await make();
    await s.save({ ...route(), sentAt: NOW } as ReturnType<typeof route>);
    expect((await s.get(route().id))?.sentAt).toBeUndefined();
  });
});

describe("route store order", () => {
  async function make() {
    const db = createNodeSqliteDriver(":memory:");
    await migrate(db);
    return createRouteStore(db);
  }

  it("breaks a tie on the creation time by id, descending", async () => {
    const s = await make();
    const createdAt = "2026-01-01T08:00:00.000Z";
    for (const n of [1, 3, 2])
      await s.save(route({ id: `1111111${n}-1111-4111-8111-111111111111`, createdAt }));
    expect((await s.list()).map((i) => i.id[7])).toEqual(["3", "2", "1"]);
  });

  it("orders by the instant, not the text, when a time carries an offset", async () => {
    const s = await make();
    await s.save(
      route({ id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-01-01T09:00:00+02:00" }),
    );
    await s.save(
      route({ id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-01-01T08:00:00.000Z" }),
    );
    expect((await s.list()).map((i) => i.id[0])).toEqual(["2", "1"]);
  });
});

describe("route store with a row whose JSON does not parse", () => {
  it("lists the other routes and counts the one it could not read", async () => {
    const db = createNodeSqliteDriver(":memory:");
    await migrate(db);
    const s = createRouteStore(db);
    await s.save(route({ id: "11111111-1111-4111-8111-111111111111" }));
    await s.save(route({ id: "22222222-2222-4222-8222-222222222222" }));
    await db.run("UPDATE routes SET stats_json = '{' WHERE id = ?", [
      "22222222-2222-4222-8222-222222222222",
    ]);
    const got = await s.listReadable();
    expect(got.items.map((i) => i.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(got.unreadable).toBe(1);
    expect((await s.list()).map((i) => i.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });
});
