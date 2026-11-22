import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aes256DecryptBlock } from "../../../src/db/aes256.js";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

describe("aes256DecryptBlock", () => {
  it("decrypts the FIPS 197 appendix C.3 vector", () => {
    const key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const out = aes256DecryptBlock(key, hex("8ea2b7ca516745bfeafc49904b496089"));
    expect(Buffer.from(out).toString("hex")).toBe("00112233445566778899aabbccddeeff");
  });

  it("agrees with node's AES-256 on random keys and blocks", () => {
    for (let i = 0; i < 50; i++) {
      const key = randomBytes(32);
      const plain = randomBytes(16);
      const c = createCipheriv("aes-256-ecb", key, null);
      c.setAutoPadding(false);
      const enc = Buffer.concat([c.update(plain), c.final()]);
      expect(Buffer.from(aes256DecryptBlock(key, enc))).toEqual(plain);
    }
  });

  it("rejects a key or a block of the wrong size", () => {
    expect(() => aes256DecryptBlock(new Uint8Array(16), new Uint8Array(16))).toThrow(RangeError);
    expect(() => aes256DecryptBlock(new Uint8Array(32), new Uint8Array(15))).toThrow(RangeError);
  });
});
