import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { hex as pageHex } from "../../../app/src/sha256.ts";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: vi.fn(
    async (_algorithm: string, data: Uint8Array) =>
      Uint8Array.from(createHash("sha256").update(data).digest()).buffer,
  ),
}));

const { gpxRevision } = await import("../../src/platform/sha256.js");

beforeEach(() => vi.clearAllMocks());

interface Vector {
  name: string;
  canonical?: string;
}

// The revision in link/'s vectors was computed by link/'s Kotlin (and bench/sha256.test.js checks the
// page's copy against the same file), so the phone, the page and the watch cannot drift apart.
const vectors: { cases: Vector[] } = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../link/src/test/resources/vectors/messages.json"),
    "utf8",
  ),
);
const offers = vectors.cases
  .filter((c) => c.canonical !== undefined)
  .map((c) => ({ name: c.name, message: JSON.parse(c.canonical as string) }))
  .filter((c) => c.message.type === "routeOffer");

it("has route offers in link's vectors to check against", () => {
  expect(offers.length).toBeGreaterThanOrEqual(2);
});

it.each(offers.map((o) => [o.name, o.message] as const))(
  "computes the revision link's vectors hold for %s",
  async (_name, message) => {
    expect(await gpxRevision(message.gpx)).toBe(message.revision);
  },
);

it("hashes the UTF-8 bytes of the GPX, 64 lowercase hex digits", async () => {
  expect(await gpxRevision("")).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(await gpxRevision("é")).toBe(
    createHash("sha256").update(Buffer.from("é", "utf8")).digest("hex"),
  );
});

it.each(offers.map((o) => [o.name, o.message] as const))(
  "the page's own SHA-256 gives the phone's revision for %s",
  async (_name, message) => {
    expect(pageHex(message.gpx)).toBe(await gpxRevision(message.gpx));
  },
);
