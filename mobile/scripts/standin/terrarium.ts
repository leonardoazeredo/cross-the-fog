import { deflateSync } from "node:zlib";

// Terrarium elevation tiles for the e2e stand-in: a gentle made-up relief that is continuous across tiles, because
// it is a function of the pixel's place in the whole zoom-12 grid, and never a real place's heights.

const SIZE = 256;

/** The height in metres at a pixel of the whole grid. */
export function heightAt(globalX: number, globalY: number): number {
  return 200 + 60 * Math.sin(globalX / 700) * Math.cos(globalY / 900);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A 256x256 PNG of the terrarium encoding (height = R * 256 + G + B / 256 - 32768) for tile `x`, `y`. */
export function terrariumTile(x: number, y: number): Uint8Array {
  const raw = new Uint8Array(SIZE * (1 + SIZE * 3));
  for (let py = 0; py < SIZE; py++) {
    const row = py * (1 + SIZE * 3);
    for (let px = 0; px < SIZE; px++) {
      const v = heightAt(x * SIZE + px, y * SIZE + py) + 32768;
      const whole = Math.floor(v);
      raw[row + 1 + px * 3] = whole >> 8;
      raw[row + 2 + px * 3] = whole & 0xff;
      raw[row + 3 + px * 3] = Math.floor((v - whole) * 256);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, SIZE);
  view.setUint32(4, SIZE);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}
