import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encode, type NativeToWeb, parseNativeToWeb } from "../../../src/bridge/protocol.js";
import { COPY } from "../../../src/copy.js";
import { createSendFlow } from "../../../src/flows/send.js";
import { createMemoryRouteStore } from "../../../src/history/memoryStores.js";
import { createFakeWatchLink } from "../../../src/link/fakeWatchLink.js";
import { StagingKeyUnusableError } from "../../../src/link/stagingKeyError.js";
import { route } from "../history/fixtures.js";

// What the phone computes, written here with node:crypto; the shipping one is checked against link/'s vectors in revision.test.ts.
const revisionOf = async (gpx: string) => createHash("sha256").update(gpx, "utf8").digest("hex");

function setup(listen = true) {
  const link = createFakeWatchLink();
  const routes = createMemoryRouteStore({ now: () => new Date("2026-03-01T09:30:00Z") });
  const sent: NativeToWeb[] = [];
  const flow = createSendFlow({
    revisionOf,
    link,
    routes,
    send: (m) => sent.push(m),
  });
  const stop = listen ? flow.start() : () => undefined;
  return { link, routes, sent, flow, stop };
}

// What the page receives goes through the same schema; a slip here would drop the message there.
function valid(sent: NativeToWeb[]): void {
  for (const m of sent) expect(parseNativeToWeb(encode(m))).toEqual(m);
}

describe("send revisions", () => {
  it("says which GPX a status is for: the hash of the GPX it queued", async () => {
    const { sent, flow } = setup();
    const r = route({ gpx: "<gpx>one</gpx>" });
    await flow.sendRoute(r);
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "waiting",
        revision: await revisionOf(r.gpx),
      },
    ]);
    valid(sent);
  });

  it("takes a revision the page sent only when it is the hash of the GPX that came with it", async () => {
    const { link, sent, flow } = setup();
    const r = route({ gpx: "<gpx>one</gpx>", revision: await revisionOf("<gpx>other</gpx>") });
    await flow.sendRoute(r);
    expect(link.queued()).toEqual([]);
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "failed",
        why: COPY.routeNotSent,
        revision: r.revision,
      },
    ]);
    sent.length = 0;
    await flow.sendRoute({ ...r, revision: await revisionOf(r.gpx) });
    expect(sent[0]).toMatchObject({ state: "waiting" });
  });

  it("does not let a late confirmation of v1 mark v2 sent, and passes it on with its own revision", async () => {
    const { link, routes, sent, flow } = setup();
    const v1 = route({ gpx: "<gpx>v1</gpx>" });
    const v2 = route({ gpx: "<gpx>v2</gpx>" });
    await flow.sendRoute(v1);
    await flow.sendRoute(v2);
    sent.length = 0;

    link.confirmRoute(v1.id, await revisionOf(v1.gpx));
    await vi_flush();
    expect((await routes.get(v1.id))?.sentAt).toBeUndefined();
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: v1.id,
        state: "onWatch",
        revision: await revisionOf(v1.gpx),
      },
    ]);

    link.confirmRoute(v2.id, await revisionOf(v2.gpx));
    await vi_flush();
    expect((await routes.get(v2.id))?.sentAt).toBe("2026-03-01T09:30:00.000Z");
    expect(sent[1]).toMatchObject({ state: "onWatch", revision: await revisionOf(v2.gpx) });
    valid(sent);
  });

  // The rule for a watch or a phone build from before revisions: matched by route id alone, as it was.
  it("treats a confirmation with no revision as one for the route as it is now", async () => {
    const { link, routes, sent, flow } = setup();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;
    link.confirmRoute(r.id);
    await vi_flush();
    expect((await routes.get(r.id))?.sentAt).toBe("2026-03-01T09:30:00.000Z");
    expect(sent).toEqual([{ v: 1, type: "routeStatus", routeId: r.id, state: "onWatch" }]);
  });

  it("does not mark a route sent when the confirmation names a revision of a route it no longer holds", async () => {
    const { link, routes, sent } = setup();
    await link.queueRoute(route());
    link.confirmRoute(route().id, await revisionOf("<gpx>gone</gpx>"));
    await vi_flush();
    expect(await routes.get(route().id)).toBeNull();
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: route().id,
        state: "onWatch",
        revision: await revisionOf("<gpx>gone</gpx>"),
      },
    ]);
  });

  // The confirmation reads the stored route, waits for the hash, then marks it; a send that stores v2 in
  // that gap must not be marked sent by v1's confirmation.
  it("does not let a v1 confirmation that is still hashing mark the v2 a send stores meanwhile", async () => {
    const link = createFakeWatchLink();
    const routes = createMemoryRouteStore({ now: () => new Date("2026-03-01T09:30:00Z") });
    const sent: NativeToWeb[] = [];
    let hold: (() => void) | null = null;
    let hashes = 0;
    const gated = async (gpx: string) => {
      // Only the second hash is held: the confirmation's, after the first send's own.
      if (++hashes === 2) await new Promise<void>((release) => (hold = release));
      return revisionOf(gpx);
    };
    const flow = createSendFlow({ link, routes, send: (m) => sent.push(m), revisionOf: gated });
    flow.start();
    const v1 = route({ gpx: "<gpx>v1</gpx>" });
    const v2 = route({ gpx: "<gpx>v2</gpx>" });
    await flow.sendRoute(v1);
    link.confirmRoute(v1.id, await revisionOf(v1.gpx));
    await vi_flush();
    expect(hold).not.toBeNull();

    const second = flow.sendRoute(v2);
    await vi_flush();
    (hold as unknown as () => void)();
    await second;
    await vi_flush();

    expect((await routes.get(v2.id))?.sentAt).toBeUndefined();
    expect((await routes.get(v2.id))?.gpx).toBe(v2.gpx);
  });

  it("answers a failure with no revision when the hash cannot be computed, and rejects nothing", async () => {
    const link = createFakeWatchLink();
    const sent: NativeToWeb[] = [];
    const flow = createSendFlow({
      link,
      routes: createMemoryRouteStore(),
      send: (m) => sent.push(m),
      revisionOf: async () => {
        throw new Error("digest unavailable");
      },
    });
    const r = route();
    await expect(flow.sendRoute(r)).resolves.toBeUndefined();
    expect(link.queued()).toEqual([]);
    expect(sent).toEqual([
      { v: 1, type: "routeStatus", routeId: r.id, state: "failed", why: COPY.routeNotSent },
    ]);
  });

  it("still tells the page the route is on the watch, without marking it, when the hash cannot be computed", async () => {
    const link = createFakeWatchLink();
    const routes = createMemoryRouteStore();
    const sent: NativeToWeb[] = [];
    let healthy = true;
    const flow = createSendFlow({
      link,
      routes,
      send: (m) => sent.push(m),
      revisionOf: async (gpx) => {
        if (!healthy) throw new Error("digest unavailable");
        return revisionOf(gpx);
      },
    });
    flow.start();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;
    healthy = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    link.confirmRoute(r.id, "a".repeat(64));
    await vi_flush();
    expect((await routes.get(r.id))?.sentAt).toBeUndefined();
    expect(sent).toEqual([
      { v: 1, type: "routeStatus", routeId: r.id, state: "onWatch", revision: "a".repeat(64) },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("digest unavailable");
    warn.mockRestore();
  });
});

describe("send failures name their revision", () => {
  const failing = (over: { save?: boolean; queue?: boolean }) => {
    const link = createFakeWatchLink();
    const sent: NativeToWeb[] = [];
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        queueRoute: async (r) => {
          if (over.queue) throw new Error("native refused");
          return link.queueRoute(r);
        },
      },
      routes: {
        ...createMemoryRouteStore(),
        save: async () => {
          if (over.save) throw new Error("disk full");
        },
      },
      send: (m) => sent.push(m),
    });
    return { flow, sent };
  };

  it.each([
    ["a save", { save: true }],
    ["a queue", { queue: true }],
  ])(
    "carries the revision of the GPX when %s fails, the page's or the phone's own",
    async (_name, over) => {
      const gpx = "<gpx>failing</gpx>";
      const own = await revisionOf(gpx);
      for (const pageRevision of [own, undefined]) {
        const { flow, sent } = failing(over);
        await flow.sendRoute(
          route({ gpx, ...(pageRevision === undefined ? {} : { revision: pageRevision }) }),
        );
        expect(sent).toEqual([
          {
            v: 1,
            type: "routeStatus",
            routeId: route().id,
            state: "failed",
            why: COPY.routeNotSent,
            revision: own,
          },
        ]);
      }
    },
  );
});

describe("a staging key the phone cannot use", () => {
  it("says so plainly, with the revision of the GPX, when the route cannot be queued", async () => {
    const link = createFakeWatchLink();
    const sent: NativeToWeb[] = [];
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        queueRoute: async () => {
          throw new StagingKeyUnusableError("cannot use the staging key");
        },
      },
      routes: createMemoryRouteStore(),
      send: (m) => sent.push(m),
    });
    const r = route({ gpx: "<gpx>locked</gpx>" });
    await flow.sendRoute(r);
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "failed",
        why: COPY.stagingKeyUnusable,
        revision: await revisionOf(r.gpx),
      },
    ]);
    expect(COPY.stagingKeyUnusable).not.toBe(COPY.routeNotSent);
  });
});

describe("send", () => {
  it("saves the route, queues it on the link and tells the page it is waiting", async () => {
    const { link, routes, sent, flow } = setup();
    const r = route();
    await flow.sendRoute(r);

    expect(await routes.get(r.id)).toMatchObject({ id: r.id });
    expect(link.queued()).toEqual([r]);
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "waiting",
        revision: await revisionOf(r.gpx),
      },
    ]);
    valid(sent);
  });

  it("marks the route sent and says it is on the watch once the watch confirms", async () => {
    const { link, routes, sent, flow } = setup();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;

    link.confirmRoute(r.id, await revisionOf(r.gpx));
    await vi_flush();

    expect((await routes.get(r.id))?.sentAt).toBe("2026-03-01T09:30:00.000Z");
    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "onWatch",
        revision: await revisionOf(r.gpx),
      },
    ]);
    valid(sent);
  });

  it("tells the page a route set aside on the phone could not be sent, with the revision of the send it answers", async () => {
    const { link, routes, sent, flow } = setup();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;

    link.setRouteAside(r.id, await revisionOf(r.gpx));
    await vi_flush();

    expect(sent).toEqual([
      {
        v: 1,
        type: "routeStatus",
        routeId: r.id,
        state: "failed",
        why: COPY.routeNotSent,
        revision: await revisionOf(r.gpx),
      },
    ]);
    valid(sent);
    // set aside is not sent: the stored record stays unsent
    expect((await routes.get(r.id))?.sentAt).toBeUndefined();
  });

  it("tells the page a route set aside with no known revision could not be sent", async () => {
    const { link, sent, flow } = setup();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;

    link.setRouteAside(r.id);
    await vi_flush();

    expect(sent).toEqual([
      { v: 1, type: "routeStatus", routeId: r.id, state: "failed", why: COPY.routeNotSent },
    ]);
    valid(sent);
  });

  it("does not mark the route sent before the watch confirms", async () => {
    const { routes, flow } = setup();
    const r = route();
    await flow.sendRoute(r);
    expect((await routes.get(r.id))?.sentAt).toBeUndefined();
  });

  it("reports a route it could not save as failed, without the route's content", async () => {
    const { link, sent } = setup();
    const broken = createSendFlow({
      revisionOf,
      link,
      routes: {
        ...createMemoryRouteStore(),
        save: async () => {
          throw new Error("disk full at 48.1,11.5");
        },
      },
      send: (m) => sent.push(m),
    });
    const r = route();
    await broken.sendRoute(r);

    expect(link.queued()).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "routeStatus",
      routeId: r.id,
      state: "failed",
      why: COPY.routeNotSent,
    });
    expect(JSON.stringify(sent)).not.toContain("48.1");
    valid(sent);
  });

  it("reports a route the link would not queue as failed", async () => {
    const { link, routes, sent } = setup();
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        queueRoute: async () => {
          throw new Error("module unavailable");
        },
      },
      routes,
      send: (m) => sent.push(m),
    });
    const r = route();
    await flow.sendRoute(r);

    expect(sent).toEqual([
      expect.objectContaining({ type: "routeStatus", routeId: r.id, state: "failed" }),
    ]);
    valid(sent);
  });

  it("forwards link status changes to the page", async () => {
    const { link, sent } = setup();
    link.setStatus({ paired: true, reachable: true });
    expect(sent).toEqual([{ v: 1, type: "linkStatus", paired: true, reachable: true }]);
    valid(sent);
  });

  it("sends the current link status on request", async () => {
    const { link, sent, flow } = setup();
    await link.pair("payload");
    sent.length = 0;
    await flow.sendStatus();
    expect(sent).toEqual([{ v: 1, type: "linkStatus", paired: true, reachable: false }]);
  });

  it("adds the count of routes that could not be opened to the status, once", async () => {
    const { link, sent, flow } = setup();
    await link.pair("payload");
    link.stageUnreadableRoute("0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001");
    link.stageUnreadableRoute("0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0002");
    sent.length = 0;
    await flow.sendStatus();
    expect(sent).toEqual([
      { v: 1, type: "linkStatus", paired: true, reachable: false, unsentRoutes: 2 },
    ]);
    valid(sent);
    sent.length = 0;
    await flow.sendStatus();
    expect(sent).toEqual([{ v: 1, type: "linkStatus", paired: true, reachable: false }]);
  });

  it("still sends the status, and logs the class only, when the routes cannot be removed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { link, sent } = setup(false);
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        discardUnreadableRoutes: async () => {
          throw new RangeError("outbox/0b6b7a6e.bin");
        },
      },
      routes: createMemoryRouteStore(),
      send: (m) => sent.push(m),
    });
    await expect(flow.sendStatus()).resolves.toBeUndefined();
    expect(sent).toEqual([{ v: 1, type: "linkStatus", paired: false, reachable: false }]);
    expect(JSON.stringify(warn.mock.calls)).toContain("RangeError");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("outbox");
    warn.mockRestore();
  });

  it("leaves the unreadable routes alone when the status cannot be read, so the count is not lost", async () => {
    const { link, sent } = setup(false);
    link.stageUnreadableRoute("0b6b7a6e-4a53-4d6e-9a53-1f3f1d3a0001");
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        status: async () => {
          throw new Error("module unavailable");
        },
      },
      routes: createMemoryRouteStore(),
      send: (m) => sent.push(m),
    });
    await flow.sendStatus();
    expect(sent).toEqual([]);
    expect(await link.discardUnreadableRoutes()).toBe(1);
  });

  it("still tells the page the watch has the route when marking it sent fails", async () => {
    const { link, sent } = setup(false);
    const flow = createSendFlow({
      revisionOf,
      link,
      routes: {
        ...createMemoryRouteStore(),
        markSent: async () => {
          throw new Error("unknown route");
        },
      },
      send: (m) => sent.push(m),
    });
    flow.start();
    const r = route();
    await flow.sendRoute(r);
    sent.length = 0;
    link.confirmRoute(r.id);
    await vi_flush();
    expect(sent).toEqual([{ v: 1, type: "routeStatus", routeId: r.id, state: "onWatch" }]);
  });

  it("sends nothing and does not reject when the link status cannot be read", async () => {
    const { link, sent } = setup(false);
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        status: async () => {
          throw new Error("module unavailable");
        },
      },
      routes: createMemoryRouteStore(),
      send: (m) => sent.push(m),
    });
    await expect(flow.sendStatus()).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("tells the page a route the phone does not know is on the watch", async () => {
    const { link, routes, sent } = setup();
    await link.queueRoute(route());
    link.confirmRoute(route().id);
    await vi_flush();
    expect(sent).toEqual([{ v: 1, type: "routeStatus", routeId: route().id, state: "onWatch" }]);
    expect(await routes.get(route().id)).toBeNull();
  });

  it("keeps one record and one queued copy when a route that failed to queue is sent again", async () => {
    const { link, routes, sent } = setup(false);
    let refuse = true;
    const flow = createSendFlow({
      revisionOf,
      link: {
        ...link,
        queueRoute: async (r) => {
          if (refuse) throw new Error("module unavailable");
          await link.queueRoute(r);
        },
      },
      routes,
      send: (m) => sent.push(m),
    });
    const r = route();
    await flow.sendRoute(r);
    refuse = false;
    await flow.sendRoute(r);

    expect(await routes.list()).toHaveLength(1);
    expect(link.queued()).toEqual([r]);
    expect(sent.map((m) => m.type === "routeStatus" && m.state)).toEqual(["failed", "waiting"]);
  });

  it("logs only the error class of a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { link, sent } = setup(false);
      const flow = createSendFlow({
        revisionOf,
        link,
        routes: {
          ...createMemoryRouteStore(),
          save: async () => {
            throw new Error("disk full at 48.1,11.5");
          },
        },
        send: (m) => sent.push(m),
      });
      await flow.sendRoute(route());
      expect(warn.mock.calls).toEqual([[expect.any(String), "Error"]]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("48.1");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not reject when the page cannot be told", async () => {
    const { link } = setup(false);
    const flow = createSendFlow({
      revisionOf,
      link,
      routes: createMemoryRouteStore(),
      send: () => {
        throw new Error("no web view");
      },
    });
    flow.start();
    await expect(flow.sendRoute(route())).resolves.toBeUndefined();
    await expect(flow.sendStatus()).resolves.toBeUndefined();
    expect(() => link.setStatus({ paired: true, reachable: true })).not.toThrow();
  });

  it("stops listening when the returned function is called", async () => {
    const { link, sent, flow, stop } = setup();
    await flow.sendRoute(route());
    sent.length = 0;
    stop();
    link.confirmRoute(route().id);
    link.setRouteAside(route().id);
    link.setStatus({ paired: true, reachable: true });
    await vi_flush();
    expect(sent).toEqual([]);
  });
});

async function vi_flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
