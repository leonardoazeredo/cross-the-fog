import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { deflateGpx, inflateGpx } from "../../../src/history/gpxBlob.js";

const GPX = `<gpx>${'<trkpt lat="48.1" lon="11.5"/>'.repeat(40)}</gpx>`;

// positions in the deflate body whose flip still inflates, to different bytes
function silentFlips(blob: Uint8Array): number[] {
  const original = unzlibSync(blob);
  const found: number[] = [];
  for (let i = 2; i < blob.length - 4; i++) {
    const copy = blob.slice();
    copy[i] = (copy[i] as number) ^ 0x01;
    try {
      const out = unzlibSync(copy);
      if (out.length !== original.length || out.some((b, j) => b !== original[j])) found.push(i);
    } catch {
      // does not inflate: not the case under test
    }
  }
  return found;
}

describe("inflateGpx", () => {
  it("reads back what deflateGpx wrote", () => {
    expect(inflateGpx(deflateGpx(GPX))).toBe(GPX);
  });

  it("rejects a blob whose checksum is wrong, though it still inflates", () => {
    const blob = deflateGpx(GPX);
    blob[blob.length - 1] = (blob[blob.length - 1] as number) ^ 0xff;
    expect(() => unzlibSync(blob)).not.toThrow();
    expect(() => inflateGpx(blob)).toThrow(/checksum/);
  });

  it("rejects a blob damaged in its deflate body that still inflates to other text", () => {
    const blob = deflateGpx(GPX);
    const flips = silentFlips(blob);
    expect(flips.length).toBeGreaterThan(0);
    for (const i of flips) {
      const copy = blob.slice();
      copy[i] = (copy[i] as number) ^ 0x01;
      expect(() => inflateGpx(copy), `flip at ${i}`).toThrow(/checksum/);
    }
  });

  it("rejects a truncated blob", () => {
    const blob = deflateGpx(GPX);
    expect(() => inflateGpx(blob.slice(0, blob.length - 6))).toThrow();
  });
});
