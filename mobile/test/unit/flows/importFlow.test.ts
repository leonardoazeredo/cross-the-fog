import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../../../src/copy.js";
import { createImportFlow } from "../../../src/flows/importFlow.js";
import type { CopyMeta, FogStore, SourceFile } from "../../../src/fog/store.js";

const META: CopyMeta = {
  name: "Sync.zip",
  sha256: "a".repeat(64),
  size: 3,
  savedAt: "2026-10-01T09:00:00.000Z",
  source: "picker",
};

// The error message carries a path; `onlyNamesLogged` checks that only the error class reaches the log.
const fail = () => Promise.reject(new Error("disk at /data/user/0 is full"));

function setup(store: Partial<FogStore>, remount: () => Promise<void> = async () => undefined) {
  let remounts = 0;
  const full: FogStore = {
    recover: async () => ({ discardedPending: false }),
    current: async () => null,
    pending: async () => META,
    beginImport: async () => META,
    promotePending: async () => undefined,
    discardPending: async () => undefined,
    clear: async () => undefined,
    ...store,
  };
  const busy: boolean[] = [];
  const notified: string[] = [];
  const queued: string[] = [];
  const released: string[] = [];
  const confirms: string[] = [];
  const flow = createImportFlow({
    store: full,
    pickFile: async () => ({ uri: "file:///cache/a.zip", name: "a.zip" }),
    confirmReplace: async (name) => {
      confirms.push(name);
      return true;
    },
    notify: (t) => notified.push(t),
    releaseSource: async (uri) => {
      released.push(uri);
    },
    setBusy: (on) => busy.push(on),
    queueNotice: (t) => queued.push(t),
    remount: () => {
      remounts++;
      return remount();
    },
  });
  return { flow, busy, notified, queued, released, confirms, remounts: () => remounts };
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
afterEach(() => warn.mockClear());

function onlyNamesLogged(): void {
  for (const args of warn.mock.calls) {
    expect(args).toHaveLength(2);
    expect(args[1]).toBe("Error");
  }
}

const LOADED_OK = { v: 1, type: "loaded", fingerprint: META.sha256, ok: true, tiles: 1 } as const;
const LOADED_BAD = {
  v: 1,
  type: "loaded",
  fingerprint: META.sha256,
  ok: false,
  reason: "unzip",
} as const;

describe("import flow verdicts", () => {
  it("keeps a good copy and does not reload the page", async () => {
    const promoted: string[] = [];
    const { flow, busy, remounts } = setup({ promotePending: async () => void promoted.push("p") });
    await flow.pick();
    const before = remounts();

    await flow.loaded(LOADED_OK);

    expect(promoted).toEqual(["p"]);
    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(remounts()).toBe(before);
  });

  it("drops a bad copy, queues its notice and reloads the page once after the verdict", async () => {
    const discarded: string[] = [];
    const { flow, queued, remounts } = setup({
      discardPending: async () => void discarded.push("d"),
    });
    await flow.pick();
    const before = remounts();

    await flow.loaded(LOADED_BAD);

    expect(discarded).toEqual(["d"]);
    expect(flow.active()).toBe(false);
    expect(queued).toEqual([COPY.notABackup]);
    expect(remounts()).toBe(before + 1);
  });
});

describe("import flow failures", () => {
  it("drops the copy, reloads the previous fog and says so once when the good copy cannot be promoted", async () => {
    const discarded: string[] = [];
    const { flow, busy, notified, queued, remounts } = setup({
      promotePending: fail,
      discardPending: async () => void discarded.push("d"),
    });
    await flow.pick();
    expect(flow.active()).toBe(true);
    expect(remounts()).toBe(1);

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: true, tiles: 1 }),
    ).resolves.toBeUndefined();

    expect(discarded).toEqual(["d"]);
    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(queued).toEqual([COPY.importFailed]);
    expect(notified).toEqual([]);
    expect(remounts()).toBe(2);
    onlyNamesLogged();
  });

  it("tells the user now and leaves the page alone when the unkept copy cannot be dropped either", async () => {
    const { flow, busy, notified, queued, remounts } = setup({
      promotePending: fail,
      discardPending: fail,
    });
    await flow.pick();

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: true, tiles: 1 }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(queued).toEqual([]);
    expect(remounts()).toBe(1);
    onlyNamesLogged();
  });

  it("falls back to a toast when the previous fog cannot be reloaded after a failed promote", async () => {
    let remounts = 0;
    const { flow, busy, notified, queued } = setup({ promotePending: fail }, () =>
      remounts++ === 0 ? Promise.resolve() : fail(),
    );
    await flow.pick();

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: true, tiles: 1 }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(queued).toEqual([]);
    onlyNamesLogged();
  });

  it("drops a verdict's copy instead of keeping it when no import is running", async () => {
    const calls: string[] = [];
    const { flow, queued, notified } = setup({
      promotePending: async () => void calls.push("promote"),
      discardPending: async () => void calls.push("discard"),
    });

    await flow.loaded(LOADED_OK);

    expect(calls).toEqual(["discard"]);
    expect(queued).toEqual([]);
    expect(notified).toEqual([]);
    expect(flow.active()).toBe(false);
  });

  it("reloads the page after dropping a verdict's copy, and leaves it alone when the drop fails", async () => {
    const dropped = setup({});
    await dropped.flow.loaded(LOADED_OK);
    expect(dropped.remounts()).toBe(1);

    const stuck = setup({ discardPending: fail });
    await stuck.flow.loaded(LOADED_OK);
    expect(stuck.remounts()).toBe(0);
    expect(stuck.notified).toEqual([]);
    expect(stuck.queued).toEqual([]);
    onlyNamesLogged();
  });

  it("drops a bad verdict's leftover copy with no 'not a backup' notice", async () => {
    const calls: string[] = [];
    const { flow, queued, notified, remounts } = setup({
      discardPending: async () => void calls.push("discard"),
    });

    await flow.loaded({
      v: 1,
      type: "loaded",
      fingerprint: META.sha256,
      ok: false,
      reason: "unzip",
    });

    expect(calls).toEqual(["discard"]);
    expect(remounts()).toBe(1);
    expect(queued).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("drops a leftover copy's verdict while the picker is open and keeps that import going", async () => {
    const calls: string[] = [];
    let chosen: (f: SourceFile | null) => void = () => undefined;
    const flow = createImportFlow({
      store: {
        recover: async () => ({ discardedPending: false }),
        current: async () => null,
        pending: async () => META,
        beginImport: async () => META,
        promotePending: async () => void calls.push("promote"),
        discardPending: async () => void calls.push("discard"),
        clear: async () => undefined,
      },
      pickFile: () => new Promise((r) => (chosen = r)),
      confirmReplace: async () => true,
      notify: () => undefined,
      releaseSource: async () => undefined,
      setBusy: () => undefined,
      queueNotice: () => undefined,
      remount: async () => undefined,
    });
    const picking = flow.pick();

    await flow.loaded(LOADED_OK);

    expect(calls).toEqual(["discard"]);
    expect(flow.active()).toBe(true);
    chosen(null);
    await picking;
  });

  it("does not reject when the page cannot be reloaded after dropping a verdict's copy", async () => {
    const { flow, notified, queued } = setup({}, fail);

    await expect(flow.loaded(LOADED_OK)).resolves.toBeUndefined();

    expect(notified).toEqual([]);
    expect(queued).toEqual([]);
    onlyNamesLogged();
  });

  it("still takes a queued share when the unkept copy cannot be dropped either", async () => {
    const begun: string[] = [];
    const { flow, confirms } = setup({
      promotePending: fail,
      discardPending: fail,
      current: async () => META,
      beginImport: async (file) => {
        begun.push(file.name);
        return META;
      },
    });
    await flow.pick();
    await flow.incoming({ uri: "file:///cache/b.zip", name: "b.zip" });

    await flow.loaded(LOADED_OK);

    expect(confirms).toEqual(["b.zip"]);
    expect(begun).toEqual(["a.zip", "b.zip"]);
    expect(flow.active()).toBe(true);
    onlyNamesLogged();
  });

  it("drops the unkept copy and brings the previous fog back before a queued share begins", async () => {
    const calls: string[] = [];
    let remounts = 0;
    const { flow } = setup(
      {
        promotePending: fail,
        current: async () => META,
        discardPending: async () => void calls.push("discard"),
        beginImport: async () => {
          calls.push("begin");
          return META;
        },
      },
      async () => void calls.push(`remount${remounts++}`),
    );
    await flow.pick();
    await flow.incoming({ uri: "file:///cache/b.zip", name: "b.zip" });

    await flow.loaded(LOADED_OK);

    expect(calls).toEqual(["begin", "remount0", "discard", "remount1", "begin", "remount2"]);
  });

  it("ends the import when the bad copy cannot be discarded", async () => {
    const { flow, busy, notified, remounts } = setup({ discardPending: fail });
    await flow.pick();

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: false, reason: "unzip" }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(remounts()).toBe(1);
    onlyNamesLogged();
  });

  it("takes a share queued behind an import whose copy could not be kept, once", async () => {
    const { flow, confirms, remounts } = setup({ promotePending: fail, current: async () => META });
    await flow.pick();
    await flow.incoming({ uri: "file:///cache/b.zip", name: "b.zip" });
    expect(confirms).toEqual([]);

    await flow.loaded(LOADED_OK);

    expect(confirms).toEqual(["b.zip"]);
    expect(flow.active()).toBe(true);
    expect(remounts()).toBe(3);
  });

  it("ends the import and does not reject when the page cannot be reloaded after a bad copy", async () => {
    let remounts = 0;
    // The first remount shows the pending copy; only the one after the bad verdict fails.
    const { flow, busy, queued, notified } = setup({}, () =>
      remounts++ === 0 ? Promise.resolve() : fail(),
    );
    await flow.pick();

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: false, reason: "unzip" }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(queued).toEqual([]);
    expect(notified).toEqual([COPY.notABackup]);
    onlyNamesLogged();
  });

  it("keeps a running import when a refused share cannot be released", async () => {
    let choose: (f: SourceFile | null) => void = () => undefined;
    const busy: boolean[] = [];
    const flow = createImportFlow({
      store: {
        recover: async () => ({ discardedPending: false }),
        current: async () => null,
        pending: async () => META,
        beginImport: async () => META,
        promotePending: async () => undefined,
        discardPending: async () => undefined,
        clear: async () => undefined,
      },
      pickFile: () => new Promise((r) => (choose = r)),
      confirmReplace: async () => true,
      notify: () => undefined,
      releaseSource: fail,
      setBusy: (on) => busy.push(on),
      queueNotice: () => undefined,
      remount: async () => undefined,
    });
    const picking = flow.pick();

    await expect(
      flow.incoming({ uri: "file:///cache/b.7z", name: "b.7z" }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(true);
    expect(busy).toEqual([]);
    choose(null);
    await picking;
  });

  it("keeps a pick that started while a share waited on its replace question", async () => {
    let choose: (f: SourceFile | null) => void = () => undefined;
    let refuse: (e: Error) => void = () => undefined;
    const flow = createImportFlow({
      store: {
        recover: async () => ({ discardedPending: false }),
        current: async () => META,
        pending: async () => META,
        beginImport: async () => META,
        promotePending: async () => undefined,
        discardPending: async () => undefined,
        clear: async () => undefined,
      },
      pickFile: () => new Promise((r) => (choose = r)),
      confirmReplace: () =>
        new Promise<boolean>((_, j) => {
          refuse = j;
        }),
      notify: () => undefined,
      releaseSource: async () => undefined,
      setBusy: () => undefined,
      queueNotice: () => undefined,
      remount: async () => undefined,
    });
    const sharing = flow.incoming({ uri: "file:///cache/b.zip", name: "b.zip" });
    await new Promise((r) => setTimeout(r, 0));
    const picking = flow.pick();
    refuse(new Error("dialog gone"));
    await sharing;

    expect(flow.active()).toBe(true);
    choose(null);
    await picking;
  });

  it("says a shared file could not be imported when the saved fog cannot be read", async () => {
    const { flow, notified, released } = setup({ current: fail });

    await expect(
      flow.incoming({ uri: "file:///cache/b.zip", name: "b.zip" }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(released).toEqual(["file:///cache/b.zip"]);
    onlyNamesLogged();
  });

  it("ends the import when the page dies and the pending copy cannot be read", async () => {
    const { flow, busy, queued } = setup({ pending: fail });
    await flow.pick();

    await expect(flow.processGone()).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(queued).toEqual([COPY.importFailed]);
    onlyNamesLogged();
  });

  it("says at once that an import could not begin, and releases its file", async () => {
    const { flow, queued, notified, released, remounts } = setup({ beginImport: fail });
    await flow.pick();

    expect(flow.active()).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(queued).toEqual([]);
    expect(released).toEqual(["file:///cache/a.zip"]);
    expect(remounts()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    onlyNamesLogged();
  });

  it("drops a copy the page could not be reloaded to show", async () => {
    const discarded: string[] = [];
    const { flow, busy, notified } = setup(
      { discardPending: async () => void discarded.push("d") },
      fail,
    );

    await expect(flow.pick()).resolves.toBeUndefined();

    expect(discarded).toEqual(["d"]);
    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    onlyNamesLogged();
  });

  it("drops an interrupted import's copy even when the pending copy cannot be read", async () => {
    const discarded: string[] = [];
    const { flow, busy, queued } = setup({
      pending: fail,
      discardPending: async () => void discarded.push("d"),
    });
    await flow.pick();

    await flow.processGone();

    expect(discarded).toEqual(["d"]);
    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(queued).toEqual([COPY.importFailed]);
    onlyNamesLogged();
  });

  it("says an interrupted import failed once when its copy can neither be read nor dropped", async () => {
    const { flow, queued } = setup({ pending: fail, discardPending: fail });
    await flow.pick();

    await expect(flow.processGone()).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(queued).toEqual([COPY.importFailed]);
    expect(warn).toHaveBeenCalledTimes(2);
    onlyNamesLogged();
  });

  it("says nothing when the page dies with no pending copy", async () => {
    const discarded: string[] = [];
    const { flow, queued } = setup({
      pending: async () => null,
      discardPending: async () => void discarded.push("d"),
    });
    await flow.pick();

    await flow.processGone();

    expect(queued).toEqual([]);
    expect(discarded).toEqual([]);
  });

  it("says only that the file is not a zip when a refused share cannot be released", async () => {
    const notified: string[] = [];
    const flow = createImportFlow({
      store: {
        recover: async () => ({ discardedPending: false }),
        current: async () => null,
        pending: async () => null,
        beginImport: async () => META,
        promotePending: async () => undefined,
        discardPending: async () => undefined,
        clear: async () => undefined,
      },
      pickFile: async () => null,
      confirmReplace: async () => true,
      notify: (t) => notified.push(t),
      releaseSource: fail,
      setBusy: () => undefined,
      queueNotice: () => undefined,
      remount: async () => undefined,
    });

    await flow.incoming({ uri: "file:///cache/b.7z", name: "b.7z" });

    expect(notified).toEqual([COPY.zipOnly]);
    onlyNamesLogged();
  });
});
