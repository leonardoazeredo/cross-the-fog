// Sha256.hex is the page's half of a route's revision (the phone computes the same value and compares).
// Run: node bench/sha256.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
global.window = global;
require("../app/src/sha256.js");

const { hex } = global.Sha256;
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

// The page needs the script: without its tag every Send tap fails, and no other test loads index.html.
const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
const at = (name) => html.indexOf(`<script src="src/${name}"></script>`);
assert.ok(at("sha256.js") > 0, "index.html loads sha256.js");
assert.ok(at("sha256.js") < at("history.js"), "sha256.js loads before history.js");

console.log("sha256.test.js ok");
