// biome-ignore-all lint/style/noNonNullAssertion: each index is in range by construction (the 3 extra bytes that writeTile checks and the parser always hands out), and a check would cost a branch per read
// Fog of World Sync writer: a FogMap -> one zlib-compressed file per tile, in the format parser.ts reads.
// Imported blocks keep the 10 region bits they came with; blocks the app created carry region 0.
// Empty blocks and tiles are never written.
import { hex } from "./md5.ts";
import { FORMAT, FogMap, MAP_WIDTH, parseTileId } from "./parser.ts";

const {
  FILENAME_MASK1,
  TILE_WIDTH,
  TILE_HEADER_SIZE,
  BLOCK_BITMAP_SIZE,
  BLOCK_SIZE,
  blockKey,
  popcount,
} = FORMAT;
const FILENAME_MASK2 = "eizxdwknmo";
// pako at level 5 reproduces Fog of World's files byte for byte; Node's zlib at level 5 does not (bench/fog-writer.test.js)
export const DEFLATE_LEVEL = 5;

// What a failure of this module says about itself: one of these fixed words, never a position. An export that
// fails logs it beside the error's class.
export const REASONS = [
  "bad-id",
  "bad-block",
  "no-bytes",
  "verify-inflate",
  "verify-bytes",
  "verify-name",
  "verify-checksum",
] as const;
export type Reason = (typeof REASONS)[number];

const failure = <E extends Error>(error: E, reason: Reason): E => Object.assign(error, { reason });

const mapDigits = (digits: string, mask: string) =>
  Array.from(digits, (d) => mask[Number(d)]).join("");

export function tileName(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id >= MAP_WIDTH * MAP_WIDTH)
    throw failure(new RangeError("not a tile id"), "bad-id");
  const digits = String(id);
  return (
    hex(digits).slice(0, 4) +
    mapDigits(digits, FILENAME_MASK1) +
    mapDigits(digits.slice(-2), FILENAME_MASK2)
  );
}

// The 3 extra bytes as a big-endian 24-bit value: region in the top 10 bits, 2*popcount+1 in the low 14.
function extraBytes(bitmap: Uint8Array, extra: ArrayLike<number> | null | undefined): number[] {
  const region = extra ? ((extra[0]! << 16) | (extra[1]! << 8) | extra[2]!) & 0xffc000 : 0;
  const e = region | (2 * popcount(bitmap) + 1);
  return [e >> 16, (e >> 8) & 255, e & 255];
}

const inTile = (v: number) => Number.isInteger(v) && v >= 0 && v < TILE_WIDTH;

export interface WriterBlock {
  bx: number;
  by: number;
  bitmap: Uint8Array;
  extra?: ArrayLike<number> | null | undefined;
}

// blocks: [{bx, by, bitmap: 512 bytes, extra: 3 bytes | null}]. Returns the decompressed tile: the header with
// 1-based indexes in header order, then the 515-byte blocks in that order. A block the format cannot hold (a
// bitmap that is not 512 bytes, a position outside the tile, extra bytes that are not 3, a position given twice)
// throws a RangeError.
export function writeTile(blocks: WriterBlock[]): Uint8Array {
  const seen = new Set<number>();
  for (const b of blocks) {
    if (!b.bitmap || b.bitmap.length !== BLOCK_BITMAP_SIZE)
      throw failure(
        new RangeError(`a block's bitmap is not ${BLOCK_BITMAP_SIZE} bytes`),
        "bad-block",
      );
    if (!inTile(b.bx) || !inTile(b.by))
      throw failure(new RangeError("a block lies outside the tile"), "bad-block");
    if (b.extra != null && b.extra.length !== 3)
      throw failure(new RangeError("a block's extra is not 3 bytes"), "bad-block");
    const key = blockKey(b.bx, b.by);
    if (seen.has(key)) throw failure(new RangeError("a block is given twice"), "bad-block");
    seen.add(key);
  }
  const kept = blocks
    .filter((b) => b.bitmap.some((v) => v !== 0))
    .sort((a, b) => blockKey(a.bx, a.by) - blockKey(b.bx, b.by));
  const out = new Uint8Array(TILE_HEADER_SIZE + kept.length * BLOCK_SIZE);
  const dv = new DataView(out.buffer);
  kept.forEach((b, i) => {
    dv.setUint16(blockKey(b.bx, b.by) * 2, i + 1, true);
    const at = TILE_HEADER_SIZE + i * BLOCK_SIZE;
    out.set(b.bitmap, at);
    out.set(extraBytes(b.bitmap, b.extra), at + BLOCK_BITMAP_SIZE);
  });
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// The file as a reader would see it: it inflates to the tile written, its name reads back as its id, and the
// tile parses with a correct checksum on every block. Anything else would reach Fog of World as a damaged tile.
function verify(
  file: WrittenFile,
  id: number,
  raw: Uint8Array,
  inflate: (bytes: Uint8Array) => Uint8Array,
): void {
  let back: Uint8Array | undefined;
  try {
    back = inflate(file.bytes);
  } catch (e) {
    throw failure(new Error("the written file does not inflate", { cause: e }), "verify-inflate");
  }
  if (!back || !sameBytes(back, raw))
    throw failure(new Error("the written file inflates to other bytes"), "verify-bytes");
  if (parseTileId(file.name) !== id)
    throw failure(new Error("its file name reads back as another tile"), "verify-name");
  const map = new FogMap();
  map.addTile(file.name, raw);
  for (const b of map.blocks()) {
    const e = (b.extra![0]! << 16) | (b.extra![1]! << 8) | b.extra![2]!;
    if ((e & 0x3fff) !== 2 * popcount(b.bitmap) + 1)
      throw failure(new Error("a written block has a bad checksum"), "verify-checksum");
  }
}

export interface WrittenFile {
  name: string;
  bytes: Uint8Array;
}

// `deflate` compresses a tile (the page's is pako at DEFLATE_LEVEL) and `inflate` reads every file back before it
// is handed out.
export interface WriteOptions {
  deflate(raw: Uint8Array): Uint8Array;
  inflate(bytes: Uint8Array): Uint8Array;
}

// Throws on a file that does not read back, so a broken export is never saved.
export function writeSync(fogMap: FogMap, opts: WriteOptions): WrittenFile[] {
  const { deflate, inflate } = opts;
  const files: WrittenFile[] = [];
  let tid = -1,
    blocks: WriterBlock[] = [];
  const flush = () => {
    if (blocks.length === 0) return;
    const raw = writeTile(blocks);
    const bytes = deflate(raw);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0)
      throw failure(new Error("deflate returned no bytes for a tile"), "no-bytes");
    const file = { name: tileName(tid), bytes };
    verify(file, tid, raw, inflate);
    files.push(file);
  };
  // blocks() yields each tile contiguously, so a change of tile id ends a file
  for (const b of fogMap.blocks()) {
    const id = b.ty * MAP_WIDTH + b.tx;
    if (id !== tid) {
      flush();
      tid = id;
      blocks = [];
    }
    blocks.push(b);
  }
  flush();
  return files;
}

// What the page's `window.FogWriter` is made of; pageGlobals.ts gives `writeSync` the page's pako defaults.
export const FogWriter = { tileName, writeTile, writeSync, verify, REASONS };
