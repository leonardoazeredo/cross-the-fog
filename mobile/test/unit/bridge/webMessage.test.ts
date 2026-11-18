import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encode,
  type NativeToWeb,
  ORIGIN,
  type WebToNative,
} from "../../../src/bridge/protocol.js";
import { createWebMessageHandler } from "../../../src/bridge/webMessage.js";

const activityId = "0b9d8c1e-7a44-4f0b-8f3e-2d5c9a6b1f77";

function setup(over: Partial<Parameters<typeof createWebMessageHandler>[0]> = {}) {
  const sent: NativeToWeb[] = [];
  const abandoned: string[] = [];
  const received: WebToNative[] = [];
  const handle = createWebMessageHandler({
    send: (m) => sent.push(m),
    abandonExport: (id) => {
      abandoned.push(id);
    },
    onMessage: (m) => {
      received.push(m);
    },
    ...over,
  });
  return { sent, abandoned, received, handle };
}

const droppedNeedTrack = JSON.stringify({ v: 2, type: "needTrack", activityId });
const droppedExport = JSON.stringify({
  v: 1,
  type: "exportBinary",
  exportId: "e-1",
  name: "abcd",
  index: 5,
  total: 1,
  files: 1,
  data: "",
});

// A rejection that nothing handles surfaces on a later tick, so the tests wait one before looking.
async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    run();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

function classLogs(warn: { mock: { calls: unknown[][] } }, what: string): unknown[][] {
  return warn.mock.calls.filter((c) => String(c[0]).includes(what));
}

describe("createWebMessageHandler", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands a valid message from the page to the controller", () => {
    const { handle, received, sent } = setup();
    const msg = { v: 1 as const, type: "needTrack" as const, activityId };
    handle({ url: ORIGIN, data: encode(msg) });
    expect(received).toEqual([msg]);
    expect(sent).toEqual([]);
  });

  it("sends a message that fails the schema to reportDropped, not to the controller", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle, received, sent } = setup();
    handle({ url: ORIGIN, data: JSON.stringify({ v: 2, type: "needTrack", activityId }) });
    expect(received).toEqual([]);
    expect(sent).toEqual([{ v: 1, type: "trackUnavailable", activityId, reason: "readFailed" }]);
  });

  it("gives a dropped exportBinary's id to abandonExport", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle, abandoned } = setup();
    handle({
      url: ORIGIN,
      data: JSON.stringify({
        v: 1,
        type: "exportBinary",
        exportId: "e-1",
        name: "abcd",
        index: 5,
        total: 1,
        files: 1,
        data: "",
      }),
    });
    expect(abandoned).toEqual(["e-1"]);
  });

  it("ignores a message from another origin without logging or answering", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle, received, sent } = setup();
    handle({ url: "https://evil.example/", data: "{not json" });
    handle({ url: "https://evil.example/", data: encode({ v: 1, type: "ready" }) });
    expect(received).toEqual([]);
    expect(sent).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs the class once when send throws in the drop path, and nothing escapes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle } = setup({
      send: () => {
        throw new TypeError(`bridge down for ${activityId}`);
      },
    });
    expect(() => handle({ url: ORIGIN, data: droppedNeedTrack })).not.toThrow();
    const logs = classLogs(warn, "reply to a dropped message failed");
    expect(logs).toEqual([["crossfog: bridge reply to a dropped message failed", "TypeError"]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("bridge down");
  });

  it("logs the class when onMessage rejects, with no unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle } = setup({
      onMessage: () => Promise.reject(new RangeError("secret 51.05,13.7")),
    });
    const unhandled = await unhandledDuring(() =>
      handle({ url: ORIGIN, data: encode({ v: 1, type: "ready" }) }),
    );
    expect(unhandled).toEqual([]);
    expect(warn.mock.calls).toEqual([["crossfog: bridge page message failed", "RangeError"]]);
  });

  it("logs the class when onMessage throws before it returns a promise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle } = setup({
      onMessage: () => {
        throw new TypeError("x");
      },
    });
    expect(() => handle({ url: ORIGIN, data: encode({ v: 1, type: "ready" }) })).not.toThrow();
    expect(warn.mock.calls).toEqual([["crossfog: bridge page message failed", "TypeError"]]);
  });

  it("logs the class when abandonExport rejects or throws, with no unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejecting = setup({ abandonExport: () => Promise.reject(new RangeError("e-1")) });
    const unhandled = await unhandledDuring(() =>
      rejecting.handle({ url: ORIGIN, data: droppedExport }),
    );
    expect(unhandled).toEqual([]);
    const throwing = setup({
      abandonExport: () => {
        throw new TypeError("e-1");
      },
    });
    expect(() => throwing.handle({ url: ORIGIN, data: droppedExport })).not.toThrow();
    expect(classLogs(warn, "abandon a dropped export failed")).toEqual([
      ["crossfog: bridge abandon a dropped export failed", "RangeError"],
      ["crossfog: bridge abandon a dropped export failed", "TypeError"],
    ]);
  });
});
