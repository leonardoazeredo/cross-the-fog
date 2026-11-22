import type { SettingsChannel } from "../backup/settings.js";
import type { NativeToWeb } from "../bridge/protocol.js";
import { parseGpx } from "../history/gpx.js";
import type { ActivityStore, RouteStore } from "../history/types.js";
import type { WatchLink } from "../link/types.js";
import type { BackupFlows } from "./backup.js";
import type { ExportFlow } from "./exportFlow.js";
import { createHandOffFlow } from "./handOff.js";
import { createHistoryFlow } from "./history.js";
import { createSendFlow } from "./send.js";
import type { Flows } from "./types.js";
import { warnClass } from "./warn.js";

export interface ComposedFlows extends Flows {
  /** Runs the hand-off now and on every staged activity; returns the function that stops listening. */
  start(): () => void;
  /** Resolves once a hand-off pass that began after this call has finished, publishing the history if that pass stored an activity; `start` runs the same path. */
  handOffNow(): Promise<void>;
}

export interface ComposeDeps {
  link: WatchLink;
  activities: ActivityStore;
  routes: RouteStore;
  send(msg: NativeToWeb): void;
  /** Backup and restore; absent where the platform has none. */
  backup?: BackupFlows;
  settings?: SettingsChannel;
  /** The Fog of World export; absent where the platform has none. */
  exportFlow?: ExportFlow;
  /** `gpxRevision` where there is a native digest. */
  revisionOf(gpx: string): Promise<string>;
  now(): number;
}

export function createFlows(deps: ComposeDeps): ComposedFlows {
  // The page shows one "could not be read" count: walks still staged on the phone (`unreadable`) plus stored
  // walks whose row does not read (`corrupt`).
  let unreadable = 0;
  let corrupt = 0;
  const history = createHistoryFlow({
    activities: deps.activities,
    routes: deps.routes,
    send: deps.send,
    onUnreadable(count) {
      if (count === corrupt) return;
      corrupt = count;
      sendUnreadable();
    },
  });
  const sendFlow = createSendFlow({
    link: deps.link,
    routes: deps.routes,
    send: deps.send,
    revisionOf: deps.revisionOf,
  });
  const handOff = createHandOffFlow({
    link: deps.link,
    activities: deps.activities,
    parseGpx,
    now: deps.now,
  });
  // Only a change is sent, since the page keeps the last count it was told; `ready` sends a count
  // above zero again because a reloaded page starts at zero. A pass with no count to give leaves
  // the last one standing.
  function sendUnreadable(): void {
    try {
      deps.send({ v: 1, type: "unreadableActivities", count: unreadable + corrupt });
    } catch (e) {
      warnClass("hand-off", "could not send the unreadable count", e);
    }
  }

  // The page shows what the store holds, so it hears about every activity the hand-off adds.
  async function handOffAndPublish(): Promise<void> {
    const result = await handOff.run();
    if (result.stored > 0) await history.publish();
    if (result.unreadable !== null && result.unreadable !== unreadable) {
      unreadable = result.unreadable;
      sendUnreadable();
    }
  }

  // The pass does not reject; the catch only keeps a future throw from going unhandled.
  function runHandOff(): void {
    handOffAndPublish().catch((e: unknown) => warnClass("hand-off", "failed", e));
  }

  // A restore swaps the database file, so an activity committed to the old one during it would be
  // lost; the hand-off is held for the whole restore and runs again after it, taking what the watch
  // sent meanwhile.
  async function restoreHoldingHandOff(restore: () => Promise<boolean>): Promise<boolean> {
    try {
      return await handOff.hold(restore);
    } finally {
      runHandOff();
    }
  }

  const { backup } = deps;
  return {
    async ready() {
      history.pageLoaded();
      await history.publish();
      if (unreadable + corrupt > 0) sendUnreadable();
      await sendFlow.sendStatus();
    },
    handOffNow: handOffAndPublish,
    async retryHistory() {
      // The next store call opens the database again; the list then says whether it did, and the hand-off
      // takes what the watch kept staged meanwhile.
      await history.publish();
      runHandOff();
    },
    sendRoute: sendFlow.sendRoute,
    needTrack: history.needTrack,
    deleteActivity: history.deleteActivity,
    ...(deps.exportFlow && { exportBinary: deps.exportFlow.onChunk }),
    ...(backup && {
      backup: backup.backup,
      restore: () => restoreHoldingHandOff(backup.restore),
    }),
    ...(deps.settings && {
      settings: async (json: string) => deps.settings?.onSettings(json),
      settingsApplied: async () => deps.settings?.onApplied(),
    }),
    start() {
      const offSend = sendFlow.start();
      const offStaged = deps.link.on("activityStaged", runHandOff);
      runHandOff();
      return () => {
        offSend();
        offStaged();
      };
    },
  };
}
