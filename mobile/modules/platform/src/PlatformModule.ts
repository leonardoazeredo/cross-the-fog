import { NativeModule, requireNativeModule } from "expo";
import type { KeyState, PlatformNativeEvents } from "./Platform.types";

declare class PlatformModule extends NativeModule<PlatformNativeEvents> {
  getDatabaseKeyHex(): Promise<string>;
  keyState(): Promise<KeyState>;
  keyPresence(): Promise<KeyState>;
  replaceLostDatabaseKey(keyHex: string): Promise<void>;
  resetKeys(): Promise<void>;
  createDocument(name: string, mime: string): Promise<string | null>;
  displayNameOf(uri: string): Promise<string | null>;
  copyToUri(sourcePath: string, uri: string): Promise<number>;
  copyFromUri(uri: string, destPath: string): Promise<{ size: number; head: string }>;
  status(): Promise<unknown>;
  pair(qr: string): Promise<void>;
  unpair(): Promise<void>;
  pendingActivities(): Promise<unknown>;
  unreadableActivities(): Promise<unknown>;
  discardUnreadableRoutes(): Promise<unknown>;
  readActivity(id: string): Promise<string>;
  release(id: string): Promise<void>;
  queueRoute(routeJson: string): Promise<void>;
  /** Debug builds only; undefined in release. */
  stageForTest?(offerJson: string): Promise<void>;
}

export default requireNativeModule<PlatformModule>("Platform");
