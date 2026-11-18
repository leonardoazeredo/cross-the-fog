import { join } from "node:path";

export type AndroidTestMode = "jvm" | "device";

export interface AndroidPlan {
  gradleTask: string;
  needsDevice: boolean;
}

export const PLANS: Record<AndroidTestMode, AndroidPlan> = {
  jvm: { gradleTask: ":watch-link:testDebugUnitTest", needsDevice: false },
  device: { gradleTask: ":watch-link:connectedDebugAndroidTest", needsDevice: true },
};

/** The first `device` row of `adb devices`; an `offline` or `unauthorized` row is not a device to test on. */
export function attachedDevices(adbOutput: string): string[] {
  return adbOutput
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[1] === "device")
    .map((cols) => cols[0] as string);
}

/** Why the build cannot start, or null when the JDK and SDK are where Gradle needs them. */
export function missingTooling(javaHome: string | null, androidHome: string | null): string | null {
  if (!javaHome) {
    return "No JDK 21 found. Install Temurin 21 or set JAVA_HOME to it (see mobile/CLAUDE.md, Android builds).";
  }
  if (!androidHome) {
    return "No Android SDK found. Set ANDROID_HOME to it (default $HOME/Library/Android/sdk).";
  }
  return null;
}

export function defaultAndroidHome(home: string): string {
  return join(home, "Library", "Android", "sdk");
}

/** The message for a device run with nothing attached; names the one thing to do. */
export function noDeviceMessage(serial: string | undefined): string {
  return serial
    ? `No device "${serial}" is attached. Start the AVD (chase-cashew-test) and rerun.`
    : "No device is attached. Start the AVD (chase-cashew-test) and rerun.";
}
