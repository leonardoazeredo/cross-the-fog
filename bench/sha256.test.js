// Sha256.hex is the page's half of a route's revision (the phone computes the same value and compares).
// Run: node bench/sha256.test.js
"use strict";
const assert = require("assert");
const { readPage } = require("./lib/page.js");
const fs = require("fs");
const path = require("path");
// Node strips the types itself: no build step and no package at the repo root.
const { hex } = require("../app/src/sha256.ts");
assert.equal(hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
assert.equal(hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
// FIPS 180-2: two blocks, and the message length that forces a padding block of its own (56 bytes)
assert.equal(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
assert.equal(hex("a".repeat(1000000)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
// Text is hashed as UTF-8 bytes, not as UTF-16 units: é is c3 a9, an emoji is four bytes, a lone surrogate is replaced
const { createHash } = require("crypto");
for (const text of ["é", "\u{1F600}", "a\u{1F600}b", "日本語", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "\ud800"]) {
  assert.equal(hex(text), createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"), JSON.stringify(text));
}

// The same GPX the link's test vectors use: the value in messages.json is what link/'s Kotlin computed.
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "link", "src", "test", "resources", "vectors", "messages.json"), "utf8"));
let checked = 0;
for (const c of vectors.cases) {
  if (!c.canonical) continue;
  const m = JSON.parse(c.canonical);
  if (m.type !== "routeOffer") continue;
  assert.equal(hex(m.gpx), m.revision, c.name);
  checked++;
}
assert.ok(checked >= 2, "the vectors hold route offers to check against");

// The page needs the script: without its tag every Send tap fails, and nothing else checks this tag.
const html = readPage();
const engine = `<script src="src/engine.ts"></script>`;
const engineAt = html.indexOf(engine);
assert.ok(engineAt > 0, "index.html loads engine.ts, which hands the page window.Sha256");
for (const reader of ["history.js", "main.js"]) {
  const at = html.indexOf(`<script src="src/${reader}"></script>`);
  assert.ok(at > 0 && engineAt < at, `engine.ts loads before ${reader}`);
}
assert.equal((html.match(/<script\b[^>]*\bsrc="[^"]*\.ts"/g) || []).length, 1, "engine.ts is the only TypeScript script: a second tag would bundle a second copy of a module");

console.log("sha256.test.js ok");
