import { aes256DecryptBlock } from "./aes256.js";
import type { DatabaseKeyHex } from "./keyHex.js";

// SQLCipher 4 with its defaults, which is what the app's database uses: 4096-byte pages, each ending in a
// reserve of a 16-byte IV and a 64-byte HMAC. Page 1 starts with the 16-byte salt where SQLite's header
// has its magic string, so the first encrypted block holds the header's bytes 16 to 31: the page size
// (16-17), the file format versions (18-19), the reserved bytes per page (20), the payload fractions
// (21-23) and the size of the database in pages (28-31).
export const FIRST_PAGE_BYTES = 4096;
const RESERVE = 80;

export interface CipherHeader {
  pageSize: number;
  /** The database size in pages that the header records. */
  pages: number;
}

/**
 * The page size and page count in the header of a SQLCipher file, from its first page, or null when the
 * bytes do not decrypt to a header (a different cipher configuration, a wrong key, a damaged first page).
 * The checks on the fixed header bytes are what tells a header from noise.
 */
export function readCipherHeader(
  firstPage: Uint8Array,
  keyHex: DatabaseKeyHex,
): CipherHeader | null {
  if (firstPage.length < FIRST_PAGE_BYTES) return null;
  const key = Uint8Array.from(Buffer.from(keyHex, "hex"));
  const iv = firstPage.subarray(FIRST_PAGE_BYTES - RESERVE, FIRST_PAGE_BYTES - RESERVE + 16);
  const plain = aes256DecryptBlock(key, firstPage.subarray(16, 32));
  // CBC: the first block is the block cipher's output XOR the IV.
  for (let i = 0; i < 16; i++) plain[i] = (plain[i] as number) ^ (iv[i] as number);
  const view = new DataView(plain.buffer);
  const pageSize = view.getUint16(0);
  const isHeader =
    pageSize === FIRST_PAGE_BYTES &&
    plain[2] === plain[3] &&
    (plain[2] === 1 || plain[2] === 2) &&
    plain[4] === RESERVE &&
    plain[5] === 64 &&
    plain[6] === 32 &&
    plain[7] === 32;
  if (!isHeader) return null;
  const pages = view.getUint32(12);
  return pages > 0 ? { pageSize, pages } : null;
}

/**
 * Whether a file holds fewer bytes than the page count in its header says it should (a copy that was cut
 * short, at a page boundary or not), or null when its header cannot be read, which is no verdict. A file
 * longer than the header says is not short: pages added since the header was last written still count.
 */
export function fileIsShort(opts: {
  size: number;
  firstPage: Uint8Array;
  keyHex: DatabaseKeyHex;
}): boolean | null {
  const header = readCipherHeader(opts.firstPage, opts.keyHex);
  if (header === null) return null;
  return opts.size < header.pages * header.pageSize;
}
