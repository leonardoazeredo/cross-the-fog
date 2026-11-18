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
  it("ends the import and says so when the good copy cannot be promoted", async () => {
    const { flow, busy, notified, remounts } = setup({ promotePending: fail });
    await flow.pick();
    expect(flow.active()).toBe(true);
    expect(remounts()).toBe(1);

    await expect(
      flow.loaded({ v: 1, type: "loaded", fingerprint: META.sha256, ok: true, tiles: 1 }),
    ).resolves.toBeUndefined();

    expect(flow.active()).toBe(false);
    expect(busy.at(-1)).toBe(false);
    expect(notified).toEqual([COPY.importFailed]);
    expect(remounts()).toBe(1);
    onlyNamesLogged();
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
    expect(remounts()).toBe(2);
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

// A share's replace question (and the store read before it) can stay open while a pick starts; these hold the
// share at each await so the pick can start in between.
function racing(opts: {
  current: "saved" | "none";
  /** What the store answers to `beginImport` for a file; the default begins it. */
  begin?: (name: string) => Promise<CopyMeta>;
}) {
  const begun: string[] = [];
  const released: string[] = [];
  const asked: string[] = [];
  const answers: Array<(yes: boolean) => void> = [];
  const reads: Array<() => void> = [];
  let pickDone: (f: SourceFile | null) => void = () => undefined;
  let pickFail: (e: Error) => void = () => undefined;
  const flow = createImportFlow({
    store: {
      recover: async () => ({ discardedPending: false }),
      current: () =>
        new Promise((r) => {
          reads.push(() => r(opts.current === "saved" ? META : null));
        }),
      pending: async () => META,
      beginImport: async (file) => {
        begun.push(file.name);
        return opts.begin ? opts.begin(file.name) : META;
      },
      promotePending: async () => undefined,
      discardPending: async () => undefined,
      clear: async () => undefined,
    },
    pickFile: () =>
      new Promise((r, j) => {
        pickDone = r;
        pickFail = j;
      }),
    confirmReplace: (name) =>
      new Promise<boolean>((r) => {
        asked.push(name);
        answers.push(r);
      }),
    notify: () => undefined,
    releaseSource: async (uri) => {
      released.push(uri);
    },
    setBusy: () => undefined,
    queueNotice: () => undefined,
    remount: async () => undefined,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const share = (name: string) => flow.incoming({ uri: `file:///cache/${name}`, name });
  /** Starts a pick, hands it a.zip and waits until its copy is staged. */
  const pickA = async () => {
    const picking = flow.pick();
    pickDone({ uri: "file:///cache/a.zip", name: "a.zip" });
    await picking;
  };
  /** Lets the share's store read finish, so it waits on its replace question. */
  const readSaved = async () => {
    reads.shift()?.();
    await tick();
  };
  /** Starts a pick and leaves the picker open; `cancelPick` closes it with no file. */
  const startPick = () => flow.pick();
  const cancelPick = () => pickDone(null);
  const finishPick = (f: SourceFile | null) => pickDone(f);
  const failPick = () => pickFail(new Error("picker gone"));
  /** A share b whose question was confirmed while the picker was open, so it waits in the queue. */
  const queueBehindPick = async () => {
    const sharing = share("b.zip");
    await readSaved();
    const picking = startPick();
    answers[0]?.(true);
    await sharing;
    return { picking }; // wrapped: returning the promise itself would make the caller wait for the pick to end
  };
  /** The hand-over a pick that ended without a verdict must make: the queued share is asked about again. */
  const askAgain = async (picking: Promise<void>) => {
    await tick();
    reads.shift()?.();
    await tick();
    answers[1]?.(true);
    await picking;
  };
  return {
    flow,
    begun,
    released,
    asked,
    answers,
    reads,
    share,
    pickA,
    readSaved,
    tick,
    startPick,
    cancelPick,
    finishPick,
    failPick,
    queueBehindPick,
    askAgain,
  };
}

describe("a share that waits while a pick starts", () => {
  it("queues the share when the user confirms, then asks again after the pick ends", async () => {
    const t = racing({ current: "saved" });
    const sharing = t.share("b.zip");
    await t.readSaved();
    expect(t.asked).toEqual(["b.zip"]);

    await t.pickA();
    expect(t.begun).toEqual(["a.zip"]);
    t.answers[0]?.(true);
    await sharing;

    expect(t.begun).toEqual(["a.zip"]);
    expect(t.flow.active()).toBe(true);

    const ended = t.flow.loaded(LOADED_OK);
    await t.tick();
    t.reads.shift()?.();
    await t.tick();
    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    t.answers[1]?.(true);
    await ended;

    expect(t.begun).toEqual(["a.zip", "b.zip"]);
  });

  it("queues nothing when the user cancels", async () => {
    const t = racing({ current: "saved" });
    const sharing = t.share("b.zip");
    await t.readSaved();
    await t.pickA();

    t.answers[0]?.(false);
    await sharing;
    await t.flow.loaded(LOADED_OK);
    await t.tick();

    expect(t.asked).toEqual(["b.zip"]);
    expect(t.begun).toEqual(["a.zip"]);
    // a.zip is released once the pick staged it; b.zip is released because it will never be imported
    expect(t.released).toEqual(["file:///cache/a.zip", "file:///cache/b.zip"]);
  });

  it("queues the share when the pick starts during the store read, with no question to confirm", async () => {
    const t = racing({ current: "none" });
    const sharing = t.share("b.zip");
    await t.pickA();

    t.reads.shift()?.();
    await sharing;
    expect(t.begun).toEqual(["a.zip"]);
    expect(t.asked).toEqual([]);

    const ended = t.flow.loaded(LOADED_OK);
    await t.tick();
    t.reads.shift()?.();
    await ended;

    expect(t.begun).toEqual(["a.zip", "b.zip"]);
  });

  it("keeps only the newer of two queued shares when they queue in order, and releases the older one's file", async () => {
    const t = racing({ current: "saved" });
    const first = t.share("b.zip");
    await t.readSaved();
    await t.pickA();
    t.answers[0]?.(true);
    await first;

    await t.share("c.zip");

    expect(t.released).toEqual(["file:///cache/a.zip", "file:///cache/b.zip"]);
    const ended = t.flow.loaded(LOADED_OK);
    await t.tick();
    t.reads.shift()?.();
    await t.tick();
    expect(t.asked).toEqual(["b.zip", "c.zip"]);
    t.answers[1]?.(true);
    await ended;

    expect(t.begun).toEqual(["a.zip", "c.zip"]);
  });

  it("hands the queued share over when the pick is cancelled in the picker", async () => {
    const t = racing({ current: "saved" });
    const { picking } = await t.queueBehindPick();

    t.cancelPick();
    await t.askAgain(picking);

    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    expect(t.begun).toEqual(["b.zip"]);
  });

  it("hands the queued share over when the picked file is not a zip", async () => {
    const t = racing({ current: "saved" });
    const { picking } = await t.queueBehindPick();

    t.finishPick({ uri: "file:///cache/a.txt", name: "a.txt" });
    await t.askAgain(picking);

    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    expect(t.begun).toEqual(["b.zip"]);
  });

  it("hands the queued share over when the picked import cannot begin", async () => {
    const t = racing({
      current: "saved",
      begin: (name) =>
        name === "a.zip" ? Promise.reject(new Error("disk full")) : Promise.resolve(META),
    });
    const { picking } = await t.queueBehindPick();

    t.finishPick({ uri: "file:///cache/a.zip", name: "a.zip" });
    await t.askAgain(picking);

    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    expect(t.begun).toEqual(["a.zip", "b.zip"]);
  });

  it("hands the queued share over when the picker fails", async () => {
    const t = racing({ current: "saved" });
    const { picking } = await t.queueBehindPick();

    t.failPick();
    await t.askAgain(picking);

    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    expect(t.begun).toEqual(["b.zip"]);
  });

  it("hands the next queued share over when a share's own import cannot begin", async () => {
    let failB: (e: Error) => void = () => undefined;
    const t = racing({
      current: "none",
      begin: (name) =>
        name === "b.zip"
          ? new Promise<CopyMeta>((_, j) => {
              failB = j;
            })
          : Promise.resolve(META),
    });
    const first = t.share("b.zip");
    t.reads.shift()?.();
    await t.tick();
    await t.share("c.zip");

    failB(new Error("disk full"));
    await t.tick();
    t.reads.shift()?.(); // b's incoming does not end until the queued c has been handled
    await first;

    expect(t.begun).toEqual(["b.zip", "c.zip"]);
    expect(t.flow.active()).toBe(true);
  });

  it("keeps the share that reaches the queue last, and releases the one it replaces", async () => {
    const t = racing({ current: "saved" });
    const b = t.share("b.zip");
    await t.readSaved();
    await t.pickA();
    await t.share("c.zip");
    expect(t.released).toEqual(["file:///cache/a.zip"]);

    t.answers[0]?.(true);
    await b;

    expect(t.released).toEqual(["file:///cache/a.zip", "file:///cache/c.zip"]);
    const ended = t.flow.loaded(LOADED_OK);
    await t.tick();
    t.reads.shift()?.();
    await t.tick();
    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    t.answers[1]?.(true);
    await ended;
    expect(t.begun).toEqual(["a.zip", "b.zip"]);
  });

  it("keeps the cached copy when the same file is shared twice while a pick runs", async () => {
    const t = racing({ current: "saved" });
    const { picking } = await t.queueBehindPick();
    await t.share("b.zip");

    expect(t.released).toEqual([]);
    t.cancelPick();
    await t.askAgain(picking);

    expect(t.begun).toEqual(["b.zip"]);
  });

  it("does not hand a share over a second time when its own import's verdict arrives", async () => {
    const t = racing({ current: "saved" });
    const { picking } = await t.queueBehindPick();
    t.cancelPick();
    await t.askAgain(picking);
    expect(t.begun).toEqual(["b.zip"]);

    await t.flow.loaded(LOADED_OK);
    await t.tick();

    expect(t.asked).toEqual(["b.zip", "b.zip"]);
    expect(t.begun).toEqual(["b.zip"]);
    expect(t.flow.active()).toBe(false);
  });

  it("imports the share at once when no pick starts meanwhile", async () => {
    const t = racing({ current: "saved" });
    const sharing = t.share("b.zip");
    await t.readSaved();
    t.answers[0]?.(true);
    await sharing;

    expect(t.begun).toEqual(["b.zip"]);
    expect(t.asked).toEqual(["b.zip"]);
    expect(t.flow.active()).toBe(true);
  });
});
