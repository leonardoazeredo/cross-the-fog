import type { ExportChunk, RouteRecord } from "../bridge/protocol.js";

// Flows must not reject: onWebMessage awaits them with no catch, so a rejection goes unhandled.
// A flow reports its own failures to the user.
export interface Flows {
  /** The page has loaded and heard about the saved fog: send it the history and the link status. */
  ready(): Promise<void>;
  sendRoute(route: RouteRecord): Promise<void>;
  needTrack(activityId: string): Promise<void>;
  deleteActivity(activityId: string): Promise<void>;
  /** The History tab's Try again: opens the history again and publishes its state and list. */
  retryHistory(): Promise<void>;
  // The five below are absent where the platform has no export, backup or settings (the controller ignores the message then).
  exportBinary?(chunk: ExportChunk): Promise<void>;
  backup?(): Promise<void>;
  /** Resolves true when the phone's data was replaced and the page must reload. */
  restore?(): Promise<boolean>;
  /** The page's answer to `needSettings`. */
  settings?(json: string): Promise<void>;
  /** The page's confirmation that it wrote the settings from `applySettings`. */
  settingsApplied?(): Promise<void>;
}
