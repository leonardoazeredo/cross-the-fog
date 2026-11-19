import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AndroidTestMode,
  attachedDevices,
  defaultAndroidHome,
  gradleDirFor,
  LINK_DIR_FROM_ANDROID,
  linkMissingMessage,
  missingTooling,
  noDeviceMessage,
  PLANS,
  prebuildNeeded,
} from "./androidEnv.js";

const mode = process.argv[2] as AndroidTestMode | undefined;
if (mode !== "jvm" && mode !== "device" && mode !== "watch") {
  console.error("Usage: tsx scripts/android-test.ts jvm|device|watch");
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

// watch/ is committed with its own gradlew; only the phone's android/ is generated.
const phone = plan.project === "phone";

// android/ is generated and git-ignored, so a fresh checkout or worktree has none; a gate that skipped
// without it would pass while testing nothing.
const hasGradlew = existsSync(join(androidDir, "gradlew"));
if (phone && !hasGradlew) {
  say("mobile/android is missing; generating the page (about 2 s)");
  if (run("pnpm", ["generate"], mobile, env) !== 0) process.exit(1);
}

// Prebuild only when android/ is missing or predates the shared link/ include: an android/ that was
// prebuilt on purpose with other settings (CROSSFOG_E2E, say) is left as it is. Prebuild applies the
// config plugins to an existing android/ too, once (plugins/withLinkProject.cjs).
if (phone && prebuildNeeded(androidDir)) {
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
}

// A missing link/ must stop the run here: the :link:test step would otherwise be the one that quietly does not exist.
const linkDir = join(androidDir, LINK_DIR_FROM_ANDROID);
if (phone && !existsSync(join(linkDir, "build.gradle.kts"))) {
  console.error(linkMissingMessage(linkDir));
  process.exit(1);
}

// A cold run compiles the whole app (a full debug build measured 3 min 31 s when the app was imported), so the line warns it can be slow.
say(
  `gradle ${plan.gradleTasks.join(" ")} in ${phone ? "mobile/android" : "watch"} (about ${phone ? "20 to 60 s" : "10 to 40 s warm, minutes cold"}; a first run on a new machine downloads Gradle's dependencies)`,
);
const status = run("./gradlew", plan.gradleTasks, gradleDirFor(plan, mobile), env);
say(status === 0 ? "passed" : `failed (gradle exit ${status})`);
process.exit(status);
