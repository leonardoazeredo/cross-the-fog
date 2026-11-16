import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";

// The GPX is an activity's largest column, so it is kept zlib-deflated at rest. ActivityStore and
// schema migration 2 both write with deflateGpx, and the column carries no format marker, so the
// format is frozen: inflateGpx must read every row either ever wrote. A new codec needs a way to
// tell its rows apart (a tag byte or a new column) and a migration of its own.

export function deflateGpx(gpx: string): Uint8Array {
  return zlibSync(strToU8(gpx));
}

// fflate's unzlibSync drops the trailing adler32 without checking it, so a blob damaged in its deflate
// body can still inflate to other text; the checksum is how a damaged row is told from a sound one.
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] as number)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Rejects a blob that does not inflate or whose adler32 does not match its inflated bytes. */
export function inflateGpx(bytes: Uint8Array): string {
  const raw = unzlibSync(bytes);
  const stored = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    bytes.length - 4,
  );
  if (adler32(raw) !== stored) throw new Error("gpx blob checksum mismatch");
  return strFromU8(raw);
}
