import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  attachedDevices,
  defaultAndroidHome,
  LINK_MARKER,
  missingTooling,
  needsPrebuild,
  noDeviceMessage,
  PLANS,
} from "../../scripts/androidEnv.js";

describe("android test plans", () => {
  it("runs the JVM tests with no device and the instrumented ones with one", () => {
    expect(PLANS.jvm).toEqual({
      gradleTasks: [":platform:testDebugUnitTest", ":link:test"],
      needsDevice: false,
    });
    expect(PLANS.device).toEqual({
      gradleTasks: [":platform:connectedDebugAndroidTest"],
      needsDevice: true,
    });
  });
});

describe("attachedDevices", () => {
  it("lists only rows in the device state", () => {
    const out =
      "List of devices attached\nemulator-5554\tdevice\nR58N\toffline\nabc123\tunauthorized\n\n";
    expect(attachedDevices(out)).toEqual(["emulator-5554"]);
  });

  it("is empty when nothing is attached", () => {
    expect(attachedDevices("List of devices attached\n\n")).toEqual([]);
  });
});

describe("missingTooling", () => {
  it("says what is missing, JDK first", () => {
    expect(missingTooling(null, null)).toMatch(/JDK 21/);
    expect(missingTooling("/jdk", null)).toMatch(/ANDROID_HOME/);
    expect(missingTooling("/jdk", "/sdk")).toBeNull();
  });
});

it("names the SDK default and the missing serial", () => {
  expect(defaultAndroidHome("/Users/x")).toBe("/Users/x/Library/Android/sdk");
  expect(noDeviceMessage("emulator-5554")).toContain("emulator-5554");
  expect(noDeviceMessage(undefined)).toContain("No device is attached");
});

describe("needsPrebuild", () => {
  const { MARKER } = createRequire(import.meta.url)("../../plugins/withLinkProject.cjs");

  it("keeps the marker the config plugin writes", () => {
    expect(LINK_MARKER).toBe(MARKER);
  });

  it("asks for a prebuild when android/ is missing or predates the link include", () => {
    expect(needsPrebuild(null)).toBe(true);
    expect(needsPrebuild("include ':app'\n")).toBe(true);
  });

  it("leaves an android/ that has the include alone", () => {
    expect(needsPrebuild(`include ':app'\n${LINK_MARKER}\ninclude ':link'\n`)).toBe(false);
  });
});
