import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AndroidTestMode,
  attachedDevices,
  defaultAndroidHome,
  missingTooling,
  noDeviceMessage,
  PLANS,
} from "./androidEnv.js";

const mode = process.argv[2] as AndroidTestMode | undefined;
if (mode !== "jvm" && mode !== "device") {
  console.error("Usage: tsx scripts/android-test.ts jvm|device");
  process.exit(2);
}
const plan = PLANS[mode];

function say(text: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} android-test: ${text}`);
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): number {
  return spawnSync(cmd, args, { cwd, env, stdio: "inherit" }).status ?? 1;
}

function javaHome(): string | null {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const found = spawnSync("/usr/libexec/java_home", ["-v", "21"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() || null : null;
}

const mobile = join(import.meta.dirname, "..");
const androidDir = join(mobile, "android");
const androidHome =
  process.env.ANDROID_HOME ??
  (existsSync(defaultAndroidHome(homedir())) ? defaultAndroidHome(homedir()) : null);
const jdk = javaHome();
const tooling = missingTooling(jdk, androidHome);
if (tooling) {
  console.error(tooling);
  process.exit(1);
}
const env = { ...process.env, JAVA_HOME: jdk as string, ANDROID_HOME: androidHome as string };

if (plan.needsDevice) {
  const adb = join(androidHome as string, "platform-tools", "adb");
  const listed = spawnSync(adb, ["devices"], { encoding: "utf8" });
  const serial = process.env.ANDROID_SERIAL;
  const devices = listed.status === 0 ? attachedDevices(listed.stdout) : [];
  if (devices.length === 0 || (serial && !devices.includes(serial))) {
    console.error(noDeviceMessage(serial));
    process.exit(1);
  }
}

// android/ is generated and git-ignored, so a fresh checkout or worktree has none; a gate that skipped
// without it would pass while testing nothing.
if (!existsSync(join(androidDir, "gradlew"))) {
  say("mobile/android is missing; generating the page (about 2 s)");
  if (run("pnpm", ["generate"], mobile, env) !== 0) process.exit(1);
}

// Prebuild runs every time, not only when android/ is missing: the config plugins (the shared link/
// project in settings.gradle among them) are applied to an existing android/ too, so an old generated
// one never makes the Gradle run fail with a project it does not know. About 1 to 2 s, no install.
say("expo prebuild (about 2 s, no install)");
if (
  run(
    "pnpm",
    ["exec", "expo", "prebuild", "--platform", "android", "--no-install"],
    mobile,
    env,
  ) !== 0
) {
  process.exit(1);
}

say(
  `gradle ${plan.gradleTasks.join(" ")} (about 20 to 60 s; a first run on a new machine downloads Gradle's dependencies)`,
);
const status = run("./gradlew", plan.gradleTasks, androidDir, env);
say(status === 0 ? "passed" : `failed (gradle exit ${status})`);
process.exit(status);
