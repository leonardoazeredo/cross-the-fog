import type { WebToNative } from "../bridge/protocol.js";
import { COPY } from "../copy.js";
import type { CopyMeta, FogStore, SourceFile } from "../fog/store.js";
import { acceptIncoming } from "../import/incoming.js";
import { warnClass } from "./warn.js";

/** `notify`, `queueNotice` and `setBusy` must not throw: the import's own failure handling calls them. */
export interface ImportFlowDeps {
  store: FogStore;
  pickFile(): Promise<SourceFile | null>;
  confirmReplace(name: string): Promise<boolean>;
  notify(text: string): void;
  releaseSource(uri: string): Promise<void>;
  setBusy(on: boolean): void;
  /** Shown to the page the next time it is ready, so the flow queues only when a `ready` will follow. */
  queueNotice(text: string): void;
  /** Reloads the page; the controller owns the page's life. */
  remount(): Promise<void>;
}

/**
 * Never rejects on a store, picker or remount failure: it ends any import it started and tells the user, so
 * busy is never left on; a share that fails before it takes the import leaves a running one alone.
 */
export interface ImportFlow {
  /** An import is running (from the pick or the share to the page's verdict). */
  active(): boolean;
  pick(): Promise<void>;
  incoming(file: SourceFile): Promise<void>;
  /** A share the caller turned away: its cached copy is released like any dropped share's, so a file another share still holds stays. */
  refuse(file: SourceFile): Promise<void>;
  /** The page's verdict on the pending copy; the caller has checked that the copy is the pending one. */
  loaded(msg: Extract<WebToNative, { type: "loaded" }>): Promise<void>;
  /** The page died: an import in progress (picking, or waiting for the verdict) is abandoned, and a share queued behind it is dropped. */
  processGone(): Promise<void>;
  /**
   * A store read failed while the page was being served: an import waiting for the page's verdict is ended
   * and the user told; one still picking or being taken is left alone, and with none running nothing is said.
   */
  fail(): Promise<void>;
}

export function createImportFlow(deps: ImportFlowDeps): ImportFlow {
  const { store } = deps;

  let importActive = false;
  let pendingShare: SourceFile | null = null;
  // The share intent names its cache copy after the file, so two shares of one file are one path and one release
  // would delete the other's copy (a queued share's, or the one a running import is still reading). Every share the
  // flow has taken in holds its uri until it is done with it, and the file goes with the last holder.
  const holders = new Map<string, Set<SourceFile>>();
  // The copy is staged and the page has it; only from here can the controller's store reads fail the import.
  let awaitingVerdict = false;

  function clearImportActive(): void {
    importActive = false;
    awaitingVerdict = false;
    deps.setBusy(false);
  }

  async function endImport(): Promise<void> {
    clearImportActive();
    const queued = pendingShare;
    pendingShare = null;
    if (queued) {
      await handleIncoming(queued);
    }
  }

  // A promote that failed without saving the new fog leaves the copy pending and the page showing it, and the next
  // start's recover would drop it and tell the user a second time. So the copy goes now and the previous fog comes back, with one notice.
  async function dropUnkeptCopy(): Promise<void> {
    try {
      await store.discardPending();
    } catch (e) {
      // The copy stays, and a remount would serve it as the pending copy again and let the page's next verdict keep
      // it after the user was told it failed. The page is left alone and the next start drops the copy.
      warnClass("import", "could not drop an import it could not keep", e);
      deps.notify(COPY.importFailed);
      await endImport();
      return;
    }
    // The previous fog comes back before a queued share is taken, or the page keeps showing the dropped copy for as
    // long as that share's question is open and the share's own remount is followed by a second one.
    try {
      await deps.remount();
      deps.queueNotice(COPY.importFailed);
    } catch (e) {
      warnClass("import", "could not reload after an import it could not keep", e);
      deps.notify(COPY.importFailed);
    }
    await endImport();
  }

  // `promotePending` writes the new pointer before it removes the old pointer and pending.json, so a failure
  // in those leaves the new copy as the saved fog. An unreadable store is not an answer: the copy is then treated
  // as not kept, as before. The savedAt tells it from an older copy of the same file.
  async function newCopyIsCurrent(staged: CopyMeta | null): Promise<boolean> {
    if (!staged) return false;
    try {
      const current = await store.current();
      return current?.sha256 === staged.sha256 && current.savedAt === staged.savedAt;
    } catch (e) {
      warnClass("import", "could not read the saved fog after a failed promote", e);
      return false;
    }
  }

  // The import took effect, so it ends as one that did: nothing is dropped from the page and nothing is said. The
  // old pointer and pending.json a failed promote left are cleared if they can be. A pending.json that stays (the
  // removal failed twice) is dropped by the next start's recover, which says the import failed, as it does for any
  // pending copy.
  async function settleKeptImport(): Promise<void> {
    try {
      await store.discardPending();
    } catch (e) {
      warnClass("import", "could not clear what a kept import left behind", e);
    }
    await endImport();
  }

  function hold(file: SourceFile): void {
    const set = holders.get(file.uri) ?? new Set<SourceFile>();
    set.add(file);
    holders.set(file.uri, set);
  }

  // The cached source is a copy of the user's location history; a failed release leaves only that copy behind,
  // so it is logged and the outcome the user was told stands.
  async function release(file: SourceFile): Promise<void> {
    const others = holders.get(file.uri);
    if (others) {
      others.delete(file);
      if (others.size > 0) return;
      holders.delete(file.uri);
    }
    try {
      await deps.releaseSource(file.uri);
    } catch (e) {
      warnClass("import", "could not release a source file", e);
    }
  }

  // A failure is a toast (`notify`): a queued notice would wait for some later `ready` and show a stale failure then.
  async function doImport(file: SourceFile, source: "picker" | "share"): Promise<boolean> {
    hold(file);
    deps.setBusy(true);
    try {
      await store.beginImport(file, source);
    } catch (e) {
      warnClass("import", "could not begin an import", e);
      await release(file);
      deps.notify(COPY.importFailed);
      return false;
    }
    await release(file);
    awaitingVerdict = true;
    try {
      await deps.remount();
      return true;
    } catch (e) {
      warnClass("import", "could not show an import", e);
      // The native remount is a state bump that does not throw today; should one fail, the copy goes, or the
      // next `ready` would load the import the user was just told had failed.
      try {
        await store.discardPending();
      } catch (e2) {
        warnClass("import", "could not drop an import it could not show", e2);
      }
      deps.notify(COPY.importFailed);
      return false;
    }
  }

  // Only the share that reached the queue last is kept (an older share whose question was confirmed later replaces a
  // newer one); the one it replaces will never run, so its cached copy goes now.
  async function queueShare(file: SourceFile): Promise<void> {
    const replaced = pendingShare;
    pendingShare = file;
    if (replaced && replaced !== file) await release(replaced);
  }

  async function handleIncoming(file: SourceFile): Promise<void> {
    hold(file);
    try {
      await incoming(file);
    } catch (e) {
      warnClass("import", "could not take a shared file", e);
      // Nothing is cleared: a throw comes before this share takes the import (`doImport` catches its own),
      // so any import active now belongs to a pick or an earlier share.
      await release(file);
      deps.notify(COPY.importFailed);
    }
  }

  async function incoming(file: SourceFile): Promise<void> {
    if (!acceptIncoming(file.name)) {
      deps.notify(COPY.zipOnly);
      await release(file);
      return;
    }
    if (importActive) {
      await queueShare(file);
      return;
    }
    const current = await store.current();
    if (current) {
      const confirmed = await deps.confirmReplace(file.name);
      if (!confirmed) {
        await release(file);
        return;
      }
    }
    // A pick or another share can have started while the store read and the question were open: two imports must
    // never run at once, so this one waits its turn (`endImport` takes it and asks again).
    if (importActive) {
      await queueShare(file);
      return;
    }
    importActive = true;
    const ok = await doImport(file, "share");
    if (!ok) await endImport();
  }

  return {
    active: () => importActive,

    async pick() {
      if (importActive) return;
      importActive = true;
      // Every exit that ends the import without a verdict hands over a share that queued meanwhile, or it would wait
      // for an unrelated import to finish.
      try {
        const file = await deps.pickFile();
        if (!file) {
          await endImport();
          return;
        }
        if (!acceptIncoming(file.name)) {
          deps.notify(COPY.zipOnly);
          await endImport();
          return;
        }
        const ok = await doImport(file, "picker");
        if (!ok) await endImport();
      } catch (e) {
        warnClass("import", "could not pick a file", e);
        deps.notify(COPY.importFailed);
        await endImport();
      }
    },

    incoming: handleIncoming,

    async refuse(file) {
      hold(file);
      await release(file);
    },

    async loaded(msg) {
      if (!awaitingVerdict) {
        // A pending copy served while no import is waiting for a verdict is one the user was told had failed (a discard
        // that failed, a restore whose promote failed, a store read that ended an import); an import still choosing its
        // file has staged nothing. A verdict on it must not keep it.
        try {
          await store.discardPending();
        } catch (e) {
          // No remount: it would serve the same copy again.
          warnClass("import", "could not drop a leftover import", e);
          return;
        }
        // The page is showing the copy that was just dropped.
        try {
          await deps.remount();
        } catch (e) {
          warnClass("import", "could not reload after dropping a leftover import", e);
        }
        return;
      }
      // What the copy is before the promote, to tell afterwards whether the saved fog became it.
      let staged: CopyMeta | null = null;
      try {
        if (msg.ok) {
          staged = await store.pending();
          await store.promotePending();
        } else await store.discardPending();
      } catch (e) {
        if (msg.ok) {
          warnClass("import", "could not keep an import", e);
          if (await newCopyIsCurrent(staged)) {
            await settleKeptImport();
            return;
          }
          await dropUnkeptCopy();
          return;
        }
        // No remount: after a failed discard the page would be handed the same bad copy again.
        warnClass("import", "could not drop a bad import", e);
        deps.notify(COPY.importFailed);
        await endImport();
        return;
      }
      await endImport();
      if (msg.ok) return;
      // tiles that were there but unreadable are not "not a backup": the person would look for another file
      const why = msg.reason === "corrupt" ? COPY.damagedBackup : COPY.notABackup;
      try {
        await deps.remount();
        deps.queueNotice(why);
      } catch (e) {
        warnClass("import", "could not reload after a bad import", e);
        deps.notify(why);
      }
    },

    async fail() {
      if (!awaitingVerdict) return;
      deps.notify(COPY.importFailed);
      await endImport();
    },

    async processGone() {
      if (!importActive) return;
      // A pending copy that cannot be read may still be on disk, and the next `ready` would serve it with no import
      // active, so it is dropped unread.
      let pending: CopyMeta | null = null;
      let unreadable = false;
      try {
        pending = await store.pending();
      } catch (e) {
        warnClass("import", "could not read an interrupted import", e);
        unreadable = true;
      }
      if (pending || unreadable) {
        try {
          await store.discardPending();
        } catch (e) {
          warnClass("import", "could not drop an interrupted import", e);
        }
        // Said once whether or not the copy could be dropped: the import has failed either way.
        deps.queueNotice(COPY.importFailed);
      }
      clearImportActive();
      // The queued share will never run, and its cached source is a copy of the user's location history, so it
      // is released like every other dropped share (`release` logs a failure by class and carries on).
      const queued = pendingShare;
      pendingShare = null;
      if (queued) await release(queued);
    },
  };
}
