import { describe, expect, it } from "vitest";
import { safeExportName, utiFor } from "../../src/bridge/exportFile.js";

describe("utiFor", () => {
  it.each([
    ["fogtomaps-route.gpx", "com.topografix.gpx"],
    ["notes.txt", undefined],
  ])("utiFor(%s) is %s", (name, uti) => expect(utiFor(name)).toBe(uti));
});

describe("safeExportName", () => {
  it.each([
    ["fogtomaps-route.gpx", "fogtomaps-route.gpx"],
    ["../../Documents/fog/current-000001.json", "current-000001.json"],
    ["a b?.gpx", "a_b_.gpx"],
    ["..", "export"],
    ["dir/", "export"],
  ])("safeExportName(%j) is %j", (name, safe) => expect(safeExportName(name)).toBe(safe));
});
