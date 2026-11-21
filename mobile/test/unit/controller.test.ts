import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { RestoreFailedAfterStagingError } from "../../src/backup/restore.js";
import type { NativeToWeb, WebToNative } from "../../src/bridge/protocol.js";
import type { Controller } from "../../src/controller.js";
import { createController } from "../../src/controller.js";
import { COPY } from "../../src/copy.js";
import { createBackupFlows } from "../../src/flows/backup.js";
import type { Flows } from "../../src/flows/types.js";
import { createNoopFlows } from "../../src/flows/types.js";
import { createReloadGuard } from "../../src/fog/reloadGuard.js";
import type { SourceFile } from "../../src/fog/store.js";
import { createFogStore } from "../../src/fog/store.js";
import type { MemoryFileStore } from "../support/memoryFileStore.js";
import { createMemoryFileStore } from "../support/memoryFileStore.js";

const A = new Uint8Array([1, 2, 3]);
const B = new Uint8Array([4, 5, 6]);
const C = new Uint8Array([7, 8, 9]);
const aSrc = "file:///cache/a.zip";
const bSrc = "file:///cache/b.zip";
const cSrc = "file:///cache/c.zip";
const sources = { [aSrc]: A, [bSrc]: B, [cSrc]: C };
const NOW = Date.parse("2026-10-01T09:00:00.000Z");

const ready: WebToNative = { v: 1, type: "ready" };
const pickBackup: WebToNative = { v: 1, type: "pickBackup" };

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let res!: (v: T) => void;
  let rej!: (e: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  return { promise, resolve: res, reject: rej };
}

interface Harness {
  fs: MemoryFileStore;
  store: ReturnType<typeof createFogStore>;
  c: Controller;
  sent: NativeToWeb[];
  remounts: { count: number };
  notified: string[];
  released: string[];
  exited: { value: boolean };
  clock: { value: number };
  picks: Array<SourceFile | null>;
  pickFile: ReturnType<typeof vi.fn>;
  confirmReplace: ReturnType<typeof vi.fn>;
  confirmClear: ReturnType<typeof vi.fn>;
  shareExport: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  openAbout: ReturnType<typeof vi.fn>;
  busy: boolean[];
  flows: { [K in keyof Flows]: ReturnType<typeof vi.fn> };
  devAddActivity: ReturnType<typeof vi.fn>;
}

function createHarness(opts: { devHandler?: boolean; releaseFails?: boolean } = {}): Harness {
  const fs = createMemoryFileStore({ sources });
  const clock = { value: NOW };
  const store = createFogStore(fs, {
    sha256Hex: (b) => Promise.resolve(sha(b)),
    now: () => clock.value,
  });
  const guard = createReloadGuard(fs);
  const sent: NativeToWeb[] = [];
  const remounts = { count: 0 };
  const notified: string[] = [];
  const released: string[] = [];
  const exited = { value: false };
  const picks: Array<SourceFile | null> = [];
  const pickFile = vi.fn(() => Promise.resolve(picks.shift() ?? null));
  const confirmReplace = vi.fn(() => Promise.resolve(true));
  const confirmClear = vi.fn(() => Promise.resolve(true));
  const shareExport = vi.fn(() => Promise.resolve());
  const openExternal = vi.fn(() => Promise.resolve());
  const openAbout = vi.fn();
  const busy: boolean[] = [];
  const devAddActivity = vi.fn(() => Promise.resolve());
  const noop = createNoopFlows();
  const flows = {
    ready: vi.fn(noop.ready),
    sendRoute: vi.fn(noop.sendRoute),
    needTrack: vi.fn(noop.needTrack),
    deleteActivity: vi.fn(noop.deleteActivity),
    exportBinary: vi.fn(noop.exportBinary),
    backup: vi.fn(noop.backup),
    restore: vi.fn(noop.restore),
    settings: vi.fn(noop.settings),
    settingsApplied: vi.fn(noop.settingsApplied),
  };

  const c = createController({
    store,
    guard,
    fs,
    send: (msg) => sent.push(msg),
    remount: () => {
      remounts.count++;
    },
    pickFile,
    confirmReplace,
    confirmClear,
    notify: (text) => notified.push(text),
    shareExport,
    openExternal,
    openAbout,
    exitApp: () => {
      exited.value = true;
    },
    releaseSource: (uri) => {
      released.push(uri);
      return opts.releaseFails
        ? Promise.reject(new Error(`cannot delete ${uri} under /data/user/0`))
        : Promise.resolve();
    },
    now: () => clock.value,
    setBusy: (on) => busy.push(on),
    chunkBytes: 1_048_576,
    flows,
    ...(opts.devHandler === false ? {} : { devAddActivity }),
  });

  return {
    fs,
    store,
    c,
    sent,
    remounts,
    notified,
    released,
    exited,
    clock,
    picks,
    pickFile,
    confirmReplace,
    confirmClear,
    shareExport,
    openExternal,
    openAbout,
    busy,
    flows,
    devAddActivity,
  };
}

async function saveToStore(
  store: ReturnType<typeof createFogStore>,
  uri: string,
  name: string,
): Promise<void> {
  await store.beginImport({ uri, name }, "picker");
  await store.promotePending();
}

it("first run sends none", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage(ready);
  expect(h.sent).toEqual([{ v: 1, type: "none" }]);
});

it("tells the flows the page is ready once it has the reload message", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.flows.ready.mockImplementation(async () => {
    expect(h.sent.map((m) => m.type)).toEqual(["reload"]);
  });
  await h.c.start();
  await h.c.onWebMessage(ready);
  expect(h.flows.ready).toHaveBeenCalledTimes(1);
});

it("tells the flows again each time the page reloads", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage(ready);
  expect(h.flows.ready).toHaveBeenCalledTimes(2);
});

it("keeps the reload going when the flows' ready throws", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.flows.ready.mockRejectedValue(new Error("flow bug"));
  await h.c.start();
  await h.c.onWebMessage(ready).catch(() => undefined);
  h.sent.length = 0;

  await h.c.onWebMessage({ v: 1, type: "needBytes", fingerprint: sha(A) });
  expect(h.sent.at(-1)).toMatchObject({ type: "chunk", fingerprint: sha(A), index: 0 });
});

it("reloads the saved copy", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  expect(h.sent).toEqual([
    {
      v: 1,
      type: "reload",
      fingerprint: sha(A),
      name: "a.zip",
      savedAt: "2026-10-01T09:00:00.000Z",
      size: 3,
      role: "current",
    },
  ]);
});

it("streams only the active copy", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  h.sent.length = 0;

  await h.c.onWebMessage({ v: 1, type: "needBytes", fingerprint: sha(B) });
  expect(h.sent).toHaveLength(0);

  await h.c.onWebMessage({ v: 1, type: "needBytes", fingerprint: sha(A) });
  expect(h.sent.at(-1)).toMatchObject({ type: "chunk", fingerprint: sha(A), index: 0 });
});

it("imports a picked backup and keeps it after a good load", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.remounts.count).toBe(1);
  expect(h.released).toContain(bSrc);
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-1)).toMatchObject({ type: "reload", role: "pending", fingerprint: sha(B) });
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 2 });
  expect((await h.store.current())?.sha256).toBe(sha(B));
  expect(h.remounts.count).toBe(1);
});

it("a bad import keeps the saved fog and says so", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.remounts.count).toBe(1);
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({
    v: 1,
    type: "loaded",
    fingerprint: sha(B),
    ok: false,
    reason: "noTiles",
  });
  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(h.remounts.count).toBe(2);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-2)).toMatchObject({ type: "reload", role: "current", fingerprint: sha(A) });
  expect(h.sent.at(-1)).toEqual({ v: 1, type: "notice", text: COPY.notABackup });
});

it("a bad first import says so with nothing saved", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.remounts.count).toBe(1);
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({
    v: 1,
    type: "loaded",
    fingerprint: sha(B),
    ok: false,
    reason: "noTiles",
  });
  expect(h.remounts.count).toBe(2);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent[0]).toEqual({ v: 1, type: "none" });
  expect(h.sent[1]).toEqual({ v: 1, type: "notice", text: COPY.notABackup });
});

it("RF2: a second pickBackup during the pick is ignored", async () => {
  const h = createHarness();
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  void h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(pickBackup);
  expect(h.pickFile).toHaveBeenCalledTimes(1);
  pick.resolve(null);
});

it("RF2: a share during an import waits, then asks", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  const pickMsg = h.c.onWebMessage(pickBackup);

  await h.c.onIncoming({ uri: cSrc, name: "c.zip" });
  expect(h.confirmReplace).not.toHaveBeenCalled();

  pick.resolve({ uri: bSrc, name: "b.zip" });
  await pickMsg;
  expect(h.remounts.count).toBe(1);

  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 2 });

  expect(h.confirmReplace).toHaveBeenCalledWith("c.zip");
  expect(h.remounts.count).toBe(2);
  expect((await h.store.pending())?.sha256).toBe(sha(C));
});

it("asks before replacing with a shared file, and Cancel changes nothing", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.confirmReplace.mockResolvedValueOnce(false);
  await h.c.start();
  await h.c.onIncoming({ uri: bSrc, name: "b.zip" });
  expect(h.confirmReplace).toHaveBeenCalledWith("b.zip");
  expect(h.released).toContain(bSrc);
  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(h.remounts.count).toBe(0);
});

it("imports a shared file without asking when nothing is saved", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onIncoming({ uri: bSrc, name: "b.zip" });
  expect(h.confirmReplace).not.toHaveBeenCalled();
  expect(h.remounts.count).toBe(1);
});

it("RF5: a non-zip share or pick gets the toast and no import", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onIncoming({ uri: "file:///x/photo.jpg", name: "photo.jpg" });
  h.picks.push({ uri: "file:///x/notes.txt", name: "notes.txt" });
  await h.c.onWebMessage(pickBackup);
  expect(h.notified).toEqual([COPY.zipOnly, COPY.zipOnly]);
  expect(h.remounts.count).toBe(0);
  expect(h.released).toContain("file:///x/photo.jpg");
});

it("trips the guard after two crashed reloads", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: "reloadSuspended",
    savedAt: "2026-10-01T09:00:00.000Z",
  });
});

it("Retry lifts the suspension", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({ v: 1, type: "retryReload" });
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-1)).toMatchObject({ type: "reload", role: "current" });
});

it("Clear asks first, then empties the store", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  h.confirmClear.mockResolvedValueOnce(false);
  await h.c.onWebMessage({ v: 1, type: "clearSavedFog" });
  expect(await h.store.current()).not.toBeNull();
  expect(h.remounts.count).toBe(0);
  await h.c.onWebMessage({ v: 1, type: "clearSavedFog" });
  expect(await h.store.current()).toBeNull();
  expect(h.remounts.count).toBe(1);
});

it("an import that crashes the WebView is discarded with a notice", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.remounts.count).toBe(1);
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  expect(await h.store.pending()).toBeNull();
  expect(h.remounts.count).toBe(2);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-2)).toMatchObject({ type: "reload", role: "current", fingerprint: sha(A) });
  expect(h.sent.at(-1)).toEqual({ v: 1, type: "notice", text: COPY.importFailed });
});

it("an import left over from an app crash is discarded at start", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.store.beginImport({ uri: bSrc, name: "b.zip" }, "picker");
  await h.c.start();
  expect(await h.store.pending()).toBeNull();
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-2)).toMatchObject({ type: "reload", role: "current", fingerprint: sha(A) });
  expect(h.sent.at(-1)).toEqual({ v: 1, type: "notice", text: COPY.importFailed });
});

it("an export failure shows a toast", async () => {
  const h = createHarness();
  await h.c.start();
  h.shareExport.mockRejectedValueOnce(new Error("share failed"));
  await h.c.onWebMessage({
    v: 1,
    type: "export",
    filename: "fog.json",
    mime: "application/json",
    text: "{}",
  });
  expect(h.notified).toContain(COPY.exportFailed);
});

it("back twice within 2 s exits", async () => {
  const h = createHarness();
  await h.c.start();
  h.c.onBackPressed();
  await h.c.onWebMessage({ v: 1, type: "back:result", handled: false });
  expect(h.notified).toContain(COPY.pressBackAgain);
  expect(h.exited.value).toBe(false);
  h.clock.value += 1500;
  h.c.onBackPressed();
  await h.c.onWebMessage({ v: 1, type: "back:result", handled: false });
  expect(h.exited.value).toBe(true);
});

it("back twice over 2 s apart shows two toasts and no exit", async () => {
  const h = createHarness();
  await h.c.start();
  h.c.onBackPressed();
  await h.c.onWebMessage({ v: 1, type: "back:result", handled: false });
  h.clock.value += 2500;
  h.c.onBackPressed();
  await h.c.onWebMessage({ v: 1, type: "back:result", handled: false });
  expect(h.notified).toHaveLength(2);
  expect(h.notified[1]).toBe(COPY.pressBackAgain);
  expect(h.exited.value).toBe(false);
});

it("forwards the back button to the page", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage(ready);
  h.sent.length = 0;
  h.c.onBackPressed();
  expect(h.sent.at(-1)).toEqual({ v: 1, type: "back" });
});

it("onBackPressed before ready sends nothing", async () => {
  const h = createHarness();
  await h.c.start();
  h.c.onBackPressed();
  expect(h.sent).toHaveLength(0);
});

it("openExternal delegates to the dep", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "openExternal", url: "https://fogofworld.app" });
  expect(h.openExternal).toHaveBeenCalledWith("https://fogofworld.app");
});

it("openExternal that rejects tells the user and does not throw", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const h = createHarness();
  h.openExternal.mockRejectedValueOnce(new Error("no app for https://private.example/x"));
  await h.c.start();
  await expect(
    h.c.onWebMessage({ v: 1, type: "openExternal", url: "https://private.example/x" }),
  ).resolves.toBeUndefined();
  expect(h.notified).toEqual([COPY.openLinkFailed]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private.example");
  warn.mockRestore();
});

it("openAbout delegates to the dep", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "openAbout" });
  expect(h.openAbout).toHaveBeenCalledTimes(1);
});

it("back:result with handled=true does not exit or notify", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "back:result", handled: true });
  expect(h.exited.value).toBe(false);
  expect(h.notified).toHaveLength(0);
});

it("a successful reload resets the crash guard so a later crash does not suspend", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(A), ok: true, tiles: 5 });
  await h.c.onProcessGone();
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-1)).toMatchObject({ type: "reload", role: "current" });
});

it("loaded with wrong fingerprint and no pending is a no-op", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.c.onWebMessage(ready);
  const remountsBefore = h.remounts.count;
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 1 });
  expect(h.remounts.count).toBe(remountsBefore);
  expect((await h.store.current())?.sha256).toBe(sha(A));
});

it("loaded with non-matching pending fingerprint is a no-op", async () => {
  const h = createHarness();
  await h.store.beginImport({ uri: bSrc, name: "b.zip" }, "picker");
  await h.c.start();
  await h.c.onWebMessage(ready);
  const remountsBefore = h.remounts.count;
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(C), ok: true, tiles: 1 });
  expect(h.remounts.count).toBe(remountsBefore);
});

it("RF2: queued share is processed after a bad import", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  const pickMsg = h.c.onWebMessage(pickBackup);

  await h.c.onIncoming({ uri: cSrc, name: "c.zip" });
  expect(h.confirmReplace).not.toHaveBeenCalled();

  pick.resolve({ uri: bSrc, name: "b.zip" });
  await pickMsg;
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({
    v: 1,
    type: "loaded",
    fingerprint: sha(B),
    ok: false,
    reason: "noTiles",
  });

  expect(h.confirmReplace).toHaveBeenCalledWith("c.zip");
  expect(h.remounts.count).toBeGreaterThanOrEqual(2);
});

it("clearSavedFog during an active import is ignored", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  void h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage({ v: 1, type: "clearSavedFog" });
  expect(h.confirmClear).not.toHaveBeenCalled();
  pick.resolve(null);
});

it("needBytes streams using the pending meta when fingerprint matches pending", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(ready);
  h.sent.length = 0;
  await h.c.onWebMessage({ v: 1, type: "needBytes", fingerprint: sha(B) });
  expect(h.sent.at(-1)).toMatchObject({ type: "chunk", fingerprint: sha(B) });
});

it("pickFile returning null cancels import without notifying", async () => {
  const h = createHarness();
  await h.c.start();
  h.picks.push(null);
  await h.c.onWebMessage(pickBackup);
  expect(h.notified).toHaveLength(0);
  expect(h.remounts.count).toBe(0);
  await h.c.onWebMessage(pickBackup);
  expect(h.pickFile).toHaveBeenCalledTimes(2);
});

it("shows the import as busy from the start of the work until the page has loaded it", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.busy).toEqual([true]);
  await h.c.onWebMessage(ready);
  expect(h.busy).toEqual([true]);
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 2 });
  expect(h.busy).toEqual([true, false]);
});

it("is not busy while the file picker is open, nor after it is cancelled", async () => {
  const h = createHarness();
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  const picking = h.c.onWebMessage(pickBackup);
  await vi.waitFor(() => expect(h.pickFile).toHaveBeenCalled());
  expect(h.busy).not.toContain(true);
  pick.resolve(null);
  await picking;
  expect(h.busy).not.toContain(true);
});

it("clears busy when the page says the backup is not a backup", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({
    v: 1,
    type: "loaded",
    fingerprint: sha(B),
    ok: false,
    reason: "noTiles",
  });
  expect(h.busy).toEqual([true, false]);
});

it("clears busy when the import fails before the page is involved", async () => {
  const h = createHarness();
  h.picks.push({ uri: "file:///cache/missing.zip", name: "missing.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  expect(h.busy).toEqual([true, false]);
  expect(h.remounts.count).toBe(0);
});

it("clears busy when the WebView dies during an import", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(ready);
  await h.c.onProcessGone();
  expect(h.busy).toEqual([true, false]);
});

it("stays busy across the hand-over to a share that waited for the import", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onIncoming({ uri: cSrc, name: "c.zip" });
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 2 });
  expect(h.busy).toEqual([true, false, true]);
});

const routeId = "6f1c1a52-3f1e-4c55-9d52-0a1d6c2b7e10";
const activityId = "0b9d8c1e-7a44-4f0b-8f3e-2d5c9a6b1f77";
const route: Extract<WebToNative, { type: "sendRoute" }>["route"] = {
  id: routeId,
  createdAt: "2026-10-01T09:00:00.000Z",
  mode: "p2p",
  waypoints: [
    { lat: 10, lng: 20 },
    { lat: 10.01, lng: 20.01 },
  ],
  coords: [
    [20, 10],
    [20.01, 10.01],
  ],
  stats: { distanceM: 1000, seconds: 700, ascentM: 3, descentM: 1 },
  gpx: "<gpx/>",
};
const chunk = {
  exportId: "e1",
  name: "abcdef123456",
  index: 0,
  total: 2,
  files: 1,
  data: "AAEC",
};

it.each<[string, WebToNative, keyof Flows, unknown[]]>([
  ["sendRoute", { v: 1, type: "sendRoute", route }, "sendRoute", [route]],
  ["needTrack", { v: 1, type: "needTrack", activityId }, "needTrack", [activityId]],
  ["deleteActivity", { v: 1, type: "deleteActivity", activityId }, "deleteActivity", [activityId]],
  ["exportBinary", { v: 1, type: "exportBinary", ...chunk }, "exportBinary", [chunk]],
  ["backup", { v: 1, type: "backup" }, "backup", []],
  ["restore", { v: 1, type: "restore" }, "restore", []],
  ["settings", { v: 1, type: "settings", json: "{}" }, "settings", ["{}"]],
  ["settingsApplied", { v: 1, type: "settingsApplied" }, "settingsApplied", []],
])("routes %s to its flow once and to no other", async (_, msg, flow, args) => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage(msg);
  expect(h.flows[flow]).toHaveBeenCalledExactlyOnceWith(...args);
  for (const [name, fn] of Object.entries(h.flows)) {
    if (name !== flow) expect(fn).not.toHaveBeenCalled();
  }
  expect(h.sent).toEqual([]);
});

it("reloads the page after a restore that replaced the data", async () => {
  const h = createHarness();
  await h.c.start();
  h.flows.restore.mockResolvedValueOnce(true);
  await h.c.onWebMessage({ v: 1, type: "restore" });
  expect(h.remounts.count).toBe(1);
});

it("leaves the page alone after a restore that changed nothing", async () => {
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "restore" });
  expect(h.remounts.count).toBe(0);
});

it("refuses a restore while an import is running and says why", async () => {
  const h = createHarness();
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  void h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage({ v: 1, type: "restore" });
  expect(h.flows.restore).not.toHaveBeenCalled();
  expect(h.notified).toContain(COPY.restoreBusy);
  pick.resolve(null);
});

it("refuses an import, a clear and a shared file while a restore runs", async () => {
  const h = createHarness();
  await h.c.start();
  const restoring = deferred<boolean>();
  h.flows.restore.mockReturnValueOnce(restoring.promise);
  const running = h.c.onWebMessage({ v: 1, type: "restore" });
  await Promise.resolve();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage({ v: 1, type: "clearSavedFog" });
  await h.c.onIncoming({ uri: bSrc, name: "b.zip" });
  expect(h.pickFile).not.toHaveBeenCalled();
  expect(h.confirmClear).not.toHaveBeenCalled();
  expect(h.notified.filter((t) => t === COPY.restoreRunning)).toHaveLength(3);
  restoring.resolve(false);
  await running;
  await h.c.onWebMessage(pickBackup);
  expect(h.pickFile).toHaveBeenCalledOnce();
});

it("releases the cached copy of a share it refuses while a restore runs, once", async () => {
  const h = createHarness();
  await h.c.start();
  const restoring = deferred<boolean>();
  h.flows.restore.mockReturnValueOnce(restoring.promise);
  const running = h.c.onWebMessage({ v: 1, type: "restore" });
  await Promise.resolve();

  await h.c.onIncoming({ uri: bSrc, name: "b.zip" });

  expect(h.notified).toEqual([COPY.restoreRunning]);
  expect(h.released).toEqual([bSrc]);
  restoring.resolve(false);
  await running;
});

it("still refuses a share during a restore when its cached copy cannot be released, and logs the class only", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const h = createHarness({ releaseFails: true });
  await h.c.start();
  const restoring = deferred<boolean>();
  h.flows.restore.mockReturnValueOnce(restoring.promise);
  const running = h.c.onWebMessage({ v: 1, type: "restore" });
  await Promise.resolve();

  await expect(h.c.onIncoming({ uri: bSrc, name: "b.zip" })).resolves.toBeUndefined();

  expect(h.notified).toEqual([COPY.restoreRunning]);
  expect(warn.mock.calls).toEqual([["crossfog: import could not release a source file", "Error"]]);
  restoring.resolve(false);
  await running;
  warn.mockRestore();
});

it("keeps the cached copy a waiting share still needs when the same file is refused during a restore", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const question = deferred<boolean>();
  h.confirmReplace.mockReturnValueOnce(question.promise);
  const first = h.c.onIncoming({ uri: bSrc, name: "b.zip" });
  await vi.waitFor(() => expect(h.confirmReplace).toHaveBeenCalledOnce());
  const restoring = deferred<boolean>();
  h.flows.restore.mockReturnValueOnce(restoring.promise);
  const running = h.c.onWebMessage({ v: 1, type: "restore" });
  await Promise.resolve();

  await h.c.onIncoming({ uri: bSrc, name: "b.zip" });
  expect(h.notified).toContain(COPY.restoreRunning);
  expect(h.released).toEqual([]);

  question.resolve(true);
  await first;
  expect(h.released).toEqual([bSrc]);
  restoring.resolve(false);
  await running;
});

it("waits for the flow before the next page message is handled", async () => {
  const h = createHarness();
  const gate = deferred<void>();
  h.flows.backup.mockReturnValueOnce(gate.promise);
  await h.c.start();
  let done = false;
  const handled = h.c.onWebMessage({ v: 1, type: "backup" }).then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  gate.resolve();
  await handled;
  expect(done).toBe(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("runs the developer add-activity action in a debug app", async () => {
  vi.stubGlobal("__DEV__", true);
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "devAddActivity" });
  expect(h.devAddActivity).toHaveBeenCalledOnce();
});

it("ignores the developer add-activity message in a release app", async () => {
  vi.stubGlobal("__DEV__", false);
  const h = createHarness();
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "devAddActivity" });
  expect(h.devAddActivity).not.toHaveBeenCalled();
  expect(h.sent).toEqual([]);
});

it("does nothing for the developer add-activity message in a debug app with no handler wired", async () => {
  vi.stubGlobal("__DEV__", true);
  const h = createHarness({ devHandler: false });
  await h.c.start();
  await h.c.onWebMessage({ v: 1, type: "devAddActivity" });
  expect(h.devAddActivity).not.toHaveBeenCalled();
  expect(h.sent).toEqual([]);
});

// tsc checks the handler map against the union, so a message that passed the schema has an entry. One that did
// not (a caller that skipped the parse) names no entry of the map's own and is dropped with no effect and no error.
// The names of Object.prototype are types it has no case for too: a lookup by type must not find a function there.
it.each(["mystery", "constructor", "toString", "hasOwnProperty", "__proto__"])(
  "does nothing, and says nothing, for the type %s, which it has no case for",
  async (type) => {
    const h = createHarness();
    await h.c.start();
    await expect(
      h.c.onWebMessage({ v: 1, type } as unknown as WebToNative),
    ).resolves.toBeUndefined();
    expect(h.sent).toEqual([]);
    expect(h.notified).toEqual([]);
    expect(h.remounts.count).toBe(0);
    expect(h.busy).toEqual([]);
    expect(h.released).toEqual([]);
    expect(h.exited.value).toBe(false);
    for (const fn of [
      h.pickFile,
      h.confirmReplace,
      h.confirmClear,
      h.shareExport,
      h.openExternal,
      h.openAbout,
      h.devAddActivity,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
    for (const fn of Object.values(h.flows)) expect(fn).not.toHaveBeenCalled();
  },
);

// A store read can fail while an import waits for the page's verdict; WebShell does not await onWebMessage,
// so a rejection here would be unhandled and leave the import busy.
const importingHarness = async (): Promise<Harness> => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  return h;
};
const loadedB: WebToNative = { v: 1, type: "loaded", fingerprint: sha(B), ok: true, tiles: 2 };

it("ends the import and says so when the store read fails on loaded", async () => {
  const h = await importingHarness();
  await h.c.onWebMessage(ready);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("secret detail"));
  await expect(h.c.onWebMessage(loadedB)).resolves.toBeUndefined();
  expect(h.busy).toEqual([true, false]);
  expect(h.notified).toEqual([COPY.importFailed]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret detail");
  vi.restoreAllMocks();
  h.picks.push({ uri: cSrc, name: "c.zip" });
  await h.c.onWebMessage(pickBackup);
  expect(h.pickFile).toHaveBeenCalledTimes(2);
});

it("ends the import and says so when the current copy read fails on loaded", async () => {
  const h = await importingHarness();
  await h.c.onWebMessage(ready);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // current() is read only when no pending copy is found, so the pending read answers null here.
  vi.spyOn(h.store, "pending").mockResolvedValue(null);
  vi.spyOn(h.store, "current").mockRejectedValue(new Error("secret detail"));
  await expect(h.c.onWebMessage(loadedB)).resolves.toBeUndefined();
  expect(h.busy).toEqual([true, false]);
  expect(h.notified).toEqual([COPY.importFailed]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret detail");
});

it("ends the import and says so when the store read fails on ready", async () => {
  const h = await importingHarness();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("x"));
  await expect(h.c.onWebMessage(ready)).resolves.toBeUndefined();
  expect(h.busy).toEqual([true, false]);
  expect(h.notified).toEqual([COPY.importFailed]);
});

it("ends the import and says so when the store read fails on needBytes", async () => {
  const h = await importingHarness();
  await h.c.onWebMessage(ready);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "current").mockRejectedValue(new Error("x"));
  await expect(
    h.c.onWebMessage({ v: 1, type: "needBytes", fingerprint: sha(B) }),
  ).resolves.toBeUndefined();
  expect(h.busy).toEqual([true, false]);
  expect(h.notified).toEqual([COPY.importFailed]);
});

it("does not tell the user an import failed when a store read fails with no import running", async () => {
  const h = createHarness();
  await h.c.start();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("x"));
  await expect(h.c.onWebMessage(ready)).resolves.toBeUndefined();
  expect(h.notified).toEqual([]);
  expect(h.busy).toEqual([]);
});

it("leaves a pick that is still choosing a file alone when a store read fails", async () => {
  const h = createHarness();
  await h.c.start();
  const pick = deferred<SourceFile | null>();
  h.pickFile.mockReturnValueOnce(pick.promise);
  const picking = h.c.onWebMessage(pickBackup);
  await vi.waitFor(() => expect(h.pickFile).toHaveBeenCalled());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("x"));
  await h.c.onWebMessage(ready);
  vi.restoreAllMocks();
  expect(h.notified).toEqual([]);
  await h.c.onWebMessage(pickBackup);
  expect(h.pickFile).toHaveBeenCalledTimes(1);
  pick.resolve({ uri: bSrc, name: "b.zip" });
  await picking;
  expect(h.remounts.count).toBe(1);
});

it("hands a share that waited for the import over when a store read ends it", async () => {
  const h = await importingHarness();
  await h.c.onWebMessage(ready);
  await h.c.onIncoming({ uri: cSrc, name: "c.zip" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("x"));
  await h.c.onWebMessage(loadedB);
  vi.restoreAllMocks();
  expect(h.busy).toEqual([true, false, true]);
  expect(h.remounts.count).toBe(2);
});

it("still runs the flows' ready, and sends no verdict, when the store read fails on ready", async () => {
  const h = createHarness();
  await h.c.start();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValue(new Error("x"));
  await h.c.onWebMessage(ready);
  expect(h.flows.ready).toHaveBeenCalledTimes(1);
  expect(h.sent.filter((m) => m.type === "none" || m.type === "reload")).toEqual([]);
});

// A promote that failed or a pending copy that cannot be read must not leave a copy the user was told had failed:
// these run over the real FogStore, failing single file operations underneath it, or its `pending()` read where a test says so.
const savedThenImportingB = async (): Promise<Harness> => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(ready);
  return h;
};
const failCreatingPointers = (h: Harness): void => {
  const real = h.fs.createText.bind(h.fs);
  h.fs.createText = async (name, text) => {
    if (name.startsWith("current-")) throw new Error("path detail");
    return real(name, text);
  };
};
const failRemovingPending = (h: Harness): void => {
  const real = h.fs.remove.bind(h.fs);
  h.fs.remove = async (name) => {
    if (name === "pending.json") throw new Error("path detail");
    return real(name);
  };
};
const noNotice = (h: Harness) => h.sent.filter((m) => m.type === "notice");

it("a failed promote drops the copy, puts the previous fog back and says so once", async () => {
  const h = await savedThenImportingB();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  failCreatingPointers(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);

  expect(await h.store.pending()).toBeNull();
  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(h.remounts.count).toBe(2);
  expect(h.notified).toEqual([]);
  expect(h.busy.at(-1)).toBe(false);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("path detail");

  await h.c.onWebMessage(ready);
  expect(h.sent.find((m) => m.type === "reload")).toMatchObject({
    role: "current",
    fingerprint: sha(A),
  });
  expect(noNotice(h)).toEqual([{ v: 1, type: "notice", text: COPY.importFailed }]);
  expect(await h.store.recover()).toEqual({ discardedPending: false });
});

// Returns the working remove, for the next start's recover, which runs on a store that works again.
const failRemovingOldPointer = (h: Harness): (() => void) => {
  const real = h.fs.remove.bind(h.fs);
  h.fs.remove = async (name) => {
    if (name.startsWith("current-")) throw new Error("path detail");
    return real(name);
  };
  return () => {
    h.fs.remove = real;
  };
};

it("a promote that fails removing the old pointer has still saved the new fog, so the import is done", async () => {
  const h = await savedThenImportingB();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const repair = failRemovingOldPointer(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);

  expect((await h.store.current())?.sha256).toBe(sha(B));
  expect(await h.store.pending()).toBeNull();
  expect(h.remounts.count).toBe(1);
  expect(h.notified).toEqual([]);
  expect(h.busy.at(-1)).toBe(false);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("path detail");

  await h.c.onWebMessage(ready);
  expect(noNotice(h)).toEqual([]);
  repair();
  expect(await h.store.recover()).toEqual({ discardedPending: false });
});

const failRemovingZips = (h: Harness): void => {
  const real = h.fs.remove.bind(h.fs);
  h.fs.remove = async (name) => {
    if (name.endsWith(".zip")) throw new Error("path detail");
    return real(name);
  };
};

it("a promote that fails in its last step, after pending.json is gone, has still saved the new fog", async () => {
  const h = await savedThenImportingB();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  failRemovingZips(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);

  // The staged copy is read before the promote: afterwards pending.json is already gone.
  expect(await h.store.pending()).toBeNull();
  expect((await h.store.current())?.sha256).toBe(sha(B));
  expect(h.remounts.count).toBe(1);
  expect(h.notified).toEqual([]);
  expect(h.busy.at(-1)).toBe(false);
  expect(noNotice(h)).toEqual([]);
});

it("a promote that fails removing pending.json has still saved the new fog; the copy it cannot clear makes the next start say the import failed", async () => {
  const h = await savedThenImportingB();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const real = h.fs.remove.bind(h.fs);
  failRemovingPending(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);

  expect((await h.store.current())?.sha256).toBe(sha(B));
  expect(h.remounts.count).toBe(1);
  expect(h.notified).toEqual([]);
  expect(h.busy.at(-1)).toBe(false);
  expect(noNotice(h)).toEqual([]);

  // The accepted limit: recover drops any pending copy and says so, though the saved fog is the new one.
  h.fs.remove = real;
  expect(await h.store.recover()).toEqual({ discardedPending: true });
  expect((await h.store.current())?.sha256).toBe(sha(B));
});

it("a failed promote with nothing saved before leaves no fog and says so once", async () => {
  const h = createHarness();
  h.picks.push({ uri: bSrc, name: "b.zip" });
  await h.c.start();
  await h.c.onWebMessage(pickBackup);
  await h.c.onWebMessage(ready);
  failCreatingPointers(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);
  await h.c.onWebMessage(ready);

  expect(h.sent.find((m) => m.type === "none")).toBeDefined();
  expect(noNotice(h)).toEqual([{ v: 1, type: "notice", text: COPY.importFailed }]);
  expect(await h.store.recover()).toEqual({ discardedPending: false });
});

it("a failed promote whose copy cannot be dropped says so now and leaves the page alone", async () => {
  const h = await savedThenImportingB();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  failCreatingPointers(h);
  failRemovingPending(h);
  h.sent.length = 0;

  await expect(h.c.onWebMessage(loadedB)).resolves.toBeUndefined();

  expect(h.notified).toEqual([COPY.importFailed]);
  expect(h.remounts.count).toBe(1);
  expect(noNotice(h)).toEqual([]);
  expect(h.busy.at(-1)).toBe(false);
  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(JSON.stringify(warn.mock.calls)).not.toContain("path detail");
});

it("a page that dies while its pending copy cannot be read still loses the copy", async () => {
  const h = await savedThenImportingB();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const read = vi.spyOn(h.store, "pending").mockRejectedValueOnce(new Error("path detail"));

  await h.c.onProcessGone();
  read.mockRestore();

  expect(await h.store.pending()).toBeNull();
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent.find((m) => m.type === "reload")).toMatchObject({
    role: "current",
    fingerprint: sha(A),
  });
  expect(noNotice(h)).toEqual([{ v: 1, type: "notice", text: COPY.importFailed }]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("path detail");
});

it("a page that dies while its pending copy can neither be read nor dropped says so once", async () => {
  const h = await savedThenImportingB();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValueOnce(new Error("path detail"));
  failRemovingPending(h);

  await expect(h.c.onProcessGone()).resolves.toBeUndefined();

  expect(h.busy.at(-1)).toBe(false);
  expect(h.notified).toEqual([]);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(noNotice(h)).toEqual([{ v: 1, type: "notice", text: COPY.importFailed }]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("path detail");
});

it("a share queued behind an import whose promote failed is staged after the unkept copy is dropped", async () => {
  const h = await savedThenImportingB();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await h.c.onIncoming({ uri: cSrc, name: "c.zip" });
  failCreatingPointers(h);
  h.sent.length = 0;

  await h.c.onWebMessage(loadedB);
  await h.c.onWebMessage(ready);

  expect((await h.store.pending())?.sha256).toBe(sha(C));
  expect(h.sent.find((m) => m.type === "reload")).toMatchObject({
    role: "pending",
    fingerprint: sha(C),
  });
  expect((await h.store.current())?.sha256).toBe(sha(A));
});

it("a verdict on a copy that could not be dropped does not keep it", async () => {
  const h = await savedThenImportingB();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(h.store, "pending").mockRejectedValueOnce(new Error("path detail"));
  const realRemove = h.fs.remove.bind(h.fs);
  failRemovingPending(h);

  await h.c.onProcessGone();
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(h.sent.find((m) => m.type === "reload")).toMatchObject({ role: "pending" });
  await h.c.onWebMessage(loadedB);

  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(h.notified).toEqual([]);
  h.fs.remove = realRemove;
});

it("a verdict on a leftover copy drops it and reloads the page onto the saved fog", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  await h.store.beginImport({ uri: bSrc, name: "b.zip" }, "picker");
  await h.c.onWebMessage(ready);
  expect(h.sent.find((m) => m.type === "reload")).toMatchObject({ role: "pending" });
  const mounts = h.remounts.count;

  await h.c.onWebMessage(loadedB);

  expect(await h.store.pending()).toBeNull();
  expect((await h.store.current())?.sha256).toBe(sha(A));
  expect(h.remounts.count).toBe(mounts + 1);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);
  expect(noNotice(h)).toEqual([]);
});

it("a verdict on the copy a running restore staged leaves it for the restore to promote", async () => {
  const h = createHarness();
  await h.c.start();
  const gate = deferred<boolean>();
  h.flows.restore.mockImplementation(async () => {
    await h.store.beginImport({ uri: bSrc, name: "b.zip" }, "picker");
    await gate.promise;
    await h.store.promotePending();
    return true;
  });
  const restoring = h.c.onWebMessage({ v: 1, type: "restore" });
  await vi.waitFor(async () => expect(await h.store.pending()).not.toBeNull());

  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  await h.c.onWebMessage(loadedB);

  expect((await h.store.pending())?.sha256).toBe(sha(B));
  gate.resolve(true);
  await restoring;
  expect((await h.store.current())?.sha256).toBe(sha(B));
});

// The flow that words a restore's outcome and decides the reload (`createBackupFlows`) over the real store; the
// restore's own steps are scripted and the backup half is a stub.
function realRestoreFlow(h: Harness, run: () => Promise<"restored">) {
  const flows = createBackupFlows({
    backup: { run: async () => ({ status: "cancelled" }) },
    restore: { run },
    notify: (text) => h.notified.push(text),
  });
  h.flows.restore.mockImplementation(flows.restore);
}

it("puts the page back on the previous fog when a restore fails after the page was served its staged copy", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const gate = deferred<void>();
  realRestoreFlow(h, async () => {
    await h.store.beginImport({ uri: bSrc, name: "b.zip" }, "picker");
    await gate.promise;
    await h.store.discardPending();
    throw new RestoreFailedAfterStagingError(new Error("replace failed"));
  });
  const restoring = h.c.onWebMessage({ v: 1, type: "restore" });
  await vi.waitFor(async () => expect(await h.store.pending()).not.toBeNull());
  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  expect(h.sent.at(-1)).toMatchObject({ type: "reload", fingerprint: sha(B) });
  const mounts = h.remounts.count;

  gate.resolve();
  await restoring;
  expect(h.remounts.count).toBe(mounts + 1);
  h.sent.length = 0;
  await h.c.onWebMessage(ready);

  expect(h.sent.at(-1)).toMatchObject({ type: "reload", fingerprint: sha(A) });
  expect(h.notified.filter((t) => t === COPY.restoreFailed)).toHaveLength(1);
  expect(await h.store.pending()).toBeNull();
  warn.mockRestore();
});

it("leaves the page alone when a restore fails before it staged anything", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const mounts = h.remounts.count;
  realRestoreFlow(h, async () => {
    throw new Error("could not copy the backup");
  });

  await h.c.onWebMessage({ v: 1, type: "restore" });

  expect(h.remounts.count).toBe(mounts);
  expect(h.notified.filter((t) => t === COPY.restoreFailed)).toHaveLength(1);
  warn.mockRestore();
});

it("reloads the page once, with no failure notice, after a restore that succeeded", async () => {
  const h = createHarness();
  await h.c.start();
  const mounts = h.remounts.count;
  realRestoreFlow(h, async () => "restored");

  await h.c.onWebMessage({ v: 1, type: "restore" });

  expect(h.remounts.count).toBe(mounts + 1);
  expect(h.notified).toEqual([COPY.restoreDone]);
});

it("a verdict on the saved fog while a restore runs still clears the reload guard", async () => {
  const h = createHarness();
  await saveToStore(h.store, aSrc, "a.zip");
  await h.c.start();
  const gate = deferred<boolean>();
  h.flows.restore.mockImplementation(() => gate.promise);
  const restoring = h.c.onWebMessage({ v: 1, type: "restore" });

  await h.c.onProcessGone();
  await h.c.onWebMessage(ready);
  expect(h.fs.files.has("restoring.json")).toBe(true);
  await h.c.onWebMessage({ v: 1, type: "loaded", fingerprint: sha(A), ok: true, tiles: 1 });

  expect(h.fs.files.has("restoring.json")).toBe(false);
  gate.resolve(false);
  await restoring;
});
