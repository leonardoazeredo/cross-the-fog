import type { BackupResult } from "../backup/backup.js";
import { RestoreFailedAfterStagingError, type RestoreResult } from "../backup/restore.js";
import { BackupError } from "../backup/types.js";
import { COPY } from "../copy.js";
import { warnClass } from "./warn.js";

export interface BackupFlowsDeps {
  backup: { run(): Promise<BackupResult> };
  restore: { run(): Promise<RestoreResult> };
  /** A short result: backup outcomes and the "already running" refusal. */
  notify(text: string): void;
  /**
   * A restore's result, which the owner may want to read twice and which a toast would cut off or let vanish.
   * Must not wait for the user: the flow does not hold its lock on an alert being dismissed.
   */
  alert(text: string): void;
}

export interface BackupFlows {
  backup(): Promise<void>;
  /** True when the page must reload: the phone's data was replaced, or a restore failed after staging its fog copy. */
  restore(): Promise<boolean>;
}

// A flow must not reject, and its failures are the user's to hear about, in words that carry no
// path or position: only the error's name is logged.
export function createBackupFlows(deps: BackupFlowsDeps): BackupFlows {
  let running = false;

  async function exclusive<R>(fallback: R, fn: () => Promise<R>): Promise<R> {
    if (running) {
      deps.notify(COPY.backupRunning);
      return fallback;
    }
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  }

  return {
    backup: () =>
      exclusive(undefined, async () => {
        try {
          const result = await deps.backup.run();
          if (result.status === "saved") deps.notify(COPY.backupSaved(result.name));
        } catch (e) {
          if (e instanceof BackupError && e.code === "noSpace") deps.notify(COPY.backupNoSpace);
          else if (e instanceof BackupError && e.code === "noSettings") {
            deps.notify(COPY.backupNoSettings);
          } else {
            warnClass("backup", "failed", e);
            deps.notify(COPY.backupFailed);
          }
        }
      }),
    restore: () =>
      exclusive(false, async () => {
        try {
          const result = await deps.restore.run();
          switch (result) {
            case "restored":
              deps.alert(COPY.restoreDone);
              return true;
            case "fogNotReplaced":
              deps.alert(COPY.restoreFogNotReplaced);
              return true;
            case "settingsNotApplied":
              deps.alert(COPY.restoreSettingsNotApplied);
              return true;
            case "noSpace":
              deps.alert(COPY.restoreNoSpace);
              return false;
            case "wrongPassphrase":
              deps.alert(COPY.restoreWrongPassphrase);
              return false;
            case "notABackup":
              deps.alert(COPY.restoreNotABackup);
              return false;
            case "cancelled":
              return false;
          }
        } catch (e) {
          // A restore that failed with its copy staged and discarded: a page the renderer's death served that copy
          // still shows it, so the page reloads onto the previous fog. It is told once, here.
          const staged = e instanceof RestoreFailedAfterStagingError;
          warnClass("restore", "failed", staged ? e.cause : e);
          deps.alert(COPY.restoreFailed);
          return staged;
        }
      }),
  };
}
