import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileIsShort, readCipherHeader } from "../../../src/db/cipherHeader.js";
import { checkedKeyHex } from "../../../src/db/keyHex.js";

const KEY = checkedKeyHex("a1".repeat(32));

// Builds a page 1 the way SQLCipher 4 lays it out, keyed with the raw key: salt, the encrypted header
// block, and the IV in the reserve at the end. Only the first block matters to the reader.
function firstPage(opts: {
  pages: number;
  pageSize?: number;
  key?: string;
  reserve?: number;
}): Uint8Array {
  const page = randomBytes(4096);
  const header = Buffer.alloc(16);
  header.writeUInt16BE(opts.pageSize ?? 4096, 0);
  header[2] = 1;
  header[3] = 1;
  header[4] = opts.reserve ?? 80;
  header[5] = 64;
  header[6] = 32;
  header[7] = 32;
  header.writeUInt32BE(opts.pages, 12);
  const iv = page.subarray(4096 - 80, 4096 - 64);
  const c = createCipheriv("aes-256-cbc", Buffer.from(opts.key ?? KEY, "hex"), iv);
  c.setAutoPadding(false);
  Buffer.concat([c.update(header), c.final()]).copy(page, 16);
  return page;
}

describe("readCipherHeader", () => {
  it("reads the page size and the page count from the first block", () => {
    expect(readCipherHeader(firstPage({ pages: 169 }), KEY)).toEqual({
      pageSize: 4096,
      pages: 169,
    });
  });

  it("gives null under another key, for another page size or reserve, or for a zero count", () => {
    expect(readCipherHeader(firstPage({ pages: 5, key: "b2".repeat(32) }), KEY)).toBeNull();
    expect(readCipherHeader(firstPage({ pages: 5, pageSize: 1024 }), KEY)).toBeNull();
    expect(readCipherHeader(firstPage({ pages: 5, reserve: 48 }), KEY)).toBeNull();
    expect(readCipherHeader(firstPage({ pages: 0 }), KEY)).toBeNull();
  });

  it("gives null for fewer bytes than a page", () => {
    expect(readCipherHeader(firstPage({ pages: 5 }).subarray(0, 100), KEY)).toBeNull();
  });
});

// A file SQLCipher itself wrote (12 pages, raw key a1 repeated 32 times, cipher_compatibility 4), so the layout
// the reader assumes is checked against the real thing and not only against the test's own encryption.
describe("a file SQLCipher wrote", () => {
  const file = readFileSync(new URL("../../fixtures/sqlcipher-small.db", import.meta.url));

  it("has the page count in its header that its size shows", () => {
    expect(readCipherHeader(file.subarray(0, 4096), KEY)).toEqual({ pageSize: 4096, pages: 12 });
    expect(file.length).toBe(12 * 4096);
  });

  it("is short once cut, on a page boundary or inside a page, and not before", () => {
    const first = file.subarray(0, 4096);
    expect(fileIsShort({ size: file.length, firstPage: first, keyHex: KEY })).toBe(false);
    expect(fileIsShort({ size: 11 * 4096, firstPage: first, keyHex: KEY })).toBe(true);
    expect(fileIsShort({ size: 11 * 4096 + 7, firstPage: first, keyHex: KEY })).toBe(true);
  });
});

describe("fileIsShort", () => {
  const page = firstPage({ pages: 100 });
  it("is true for a file cut on a page boundary or inside a page", () => {
    expect(fileIsShort({ size: 99 * 4096, firstPage: page, keyHex: KEY })).toBe(true);
    expect(fileIsShort({ size: 100 * 4096 - 1, firstPage: page, keyHex: KEY })).toBe(true);
  });

  it("is false for a file of the recorded size or longer", () => {
    expect(fileIsShort({ size: 100 * 4096, firstPage: page, keyHex: KEY })).toBe(false);
    expect(fileIsShort({ size: 120 * 4096, firstPage: page, keyHex: KEY })).toBe(false);
  });

  it("is null when the header cannot be read", () => {
    expect(fileIsShort({ size: 10, firstPage: randomBytes(4096), keyHex: KEY })).toBeNull();
  });
});
