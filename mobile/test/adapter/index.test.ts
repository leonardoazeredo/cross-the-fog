import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { encode, type NativeToWeb, type WebToNative } from "../../src/bridge/protocol.js";
import { installFakeUpstream } from "./support/fakeUpstream.js";
import { loadUpstreamDom } from "./support/upstreamDom.js";

// Boots web-adapter/index.ts the way the WebView does and posts native messages to it, since the
// forwards from window.crossfog to window.CrossfogPage are lines no other test reaches.
const ACTIVITY = "0b9d8c1e-7a44-4f0b-8f3e-2d5c9a6b1f77";
const EXPORT = "e-1";

const posted: WebToNative[] = [];
const page = {
  fogMap: { addCells: vi.fn(() => 0), clearOverlay: vi.fn() },
  fogChanged: vi.fn(),
  reveal: {
    RULES: { version: 1, maxAccuracyM: 1, maxGapS: 1, maxGapM: 1, halfWidthM: 1 },
    reveal: vi.fn(() => new Int32Array()),
  },
  history: {
    setActivities: vi.fn(),
    setTrack: vi.fn(),
    trackUnavailable: vi.fn(),
    setUnreadable: vi.fn(),
  },
  routeStatus: vi.fn(),
  linkStatus: vi.fn(),
  exportStatus: vi.fn(),
};

const fromNative = (msg: NativeToWeb) =>
  window.dispatchEvent(new MessageEvent("message", { data: encode(msg) }));

beforeAll(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("CRYPTO_SUBTLE", true);
  vi.stubGlobal("CACHE_ENABLED", false);
  vi.stubGlobal("__CROSSFOG_DEV_TOOLS__", false);
  loadUpstreamDom(document);
  installFakeUpstream(window, document);
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as WebToNative),
  };
  (window as unknown as { CrossfogPage: unknown }).CrossfogPage = page;
  await import("../../web-adapter/index.js");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  // `ready` goes out last, after the listeners are in.
  await vi.waitFor(() => expect(posted.some((m) => m.type === "ready")).toBe(true));
});

describe("web-adapter/index boot", () => {
  it("forwards trackUnavailable to the History panel and the history sync", () => {
    fromNative({ v: 1, type: "trackUnavailable", activityId: ACTIVITY, reason: "notFound" });
    expect(page.history.trackUnavailable).toHaveBeenCalledWith(ACTIVITY, "notFound");
  });

  // The panel's own ask goes through window.crossfog, not through the history sync's pageApi: without the
  // adapter counting it, the second old copy would be taken for the re-ask's answer.
  it("counts the panel's track ask, so a second old copy is not taken for the re-ask's answer", async () => {
    const asks = () => posted.filter((m) => m.type === "needTrack").length;
    const item = (endedAt: string) => ({
      id: ACTIVITY,
      startedAt: "2026-01-01T10:00:00Z",
      endedAt,
      stats: { durationS: 60, distanceM: 100 },
    });
    const track = {
      v: 1 as const,
      type: "track" as const,
      activityId: ACTIVITY,
      index: 0,
      total: 1,
    };
    const before = asks();
    fromNative({ v: 1, type: "activities", items: [item("2026-01-01T11:00:00Z")] });
    await vi.waitFor(() => expect(asks()).toBe(before + 1));
    window.crossfog?.needTrack(ACTIVITY);
    fromNative({ v: 1, type: "activities", items: [item("2026-01-02T11:00:00Z")] });
    fromNative({ ...track, points: [{ t: 0, lat: 51, lon: 13.7 }] });
    fromNative({ ...track, points: [{ t: 0, lat: 51, lon: 13.7 }] });
    await vi.waitFor(() => expect(asks()).toBe(before + 3));
    expect(page.reveal.reveal).not.toHaveBeenCalled();
  });

  it("forwards exportStatus to the page", () => {
    fromNative({ v: 1, type: "exportStatus", exportId: EXPORT, state: "saved" });
    expect(page.exportStatus).toHaveBeenCalledWith({ exportId: EXPORT, state: "saved" });
  });
});
