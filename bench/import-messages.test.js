// ImportMessages: what the page says about an import, and how it counts the tiles that could not be decoded.
// Also lifts loadFromInput / loadFromZip out of main.js (a browser IIFE, see bench/main-fog-status.test.js) and runs
// them against real tiles, so the wording and the counting are checked where the person meets them.
//   node bench/import-messages.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
require("./lib/load.js");
require("../app/src/importMessages.js");
const { FogParser, ImportMessages } = global;

const FIX = path.join(__dirname, "fixtures", "fow");
const good = fs.readdirSync(FIX).filter((n) => /^[a-z0-9]{6,}$/.test(n) && !n.includes(".")).sort();
assert.equal(good.length, 2, "two tiles Fog of World wrote");
const goodBytes = (n) => fs.readFileSync(path.join(FIX, n));
// a tile's file whose body is shorter than the header: the parser throws on it, as it does on a cut file
const cut = (name) => ({ name, bytes: zlib.deflateSync(Buffer.alloc(10)) });
// a file with a tile's name whose bytes are no deflate stream at all
const junkTile = (name) => ({ name, bytes: Buffer.from("this is not zlib data") });
const goodTile = (n) => ({ name: n, bytes: goodBytes(n) });
// made-up tile names the parser reads (nameOf(1) is tile id 1), so they never collide with the two fixtures' names
const nameOf = (id) => "test" + String(id).split("").map((d) => "olhwjsktri"[Number(d)]).join("") + "zz";

const { status } = ImportMessages;

// ---- the wording
{ // a fully good import reports the tile count and nothing else
  assert.equal(status({ source: "folder", tiles: 5, added: 5, corrupt: 0, readErr: 0 }), "5 tiles loaded ✓");
  assert.equal(status({ source: "zip", tiles: 5, added: 5, corrupt: 0, readErr: 0 }), "5 tiles loaded ✓");
  assert.equal(status({ source: "folder", tiles: 5, added: 5, corrupt: 0, readErr: 2 }),
    "5 tiles loaded ✓, but 2 files couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead).");
  assert.equal(status({ source: "folder", tiles: 5, added: 5, corrupt: 0, readErr: 1 }),
    "5 tiles loaded ✓, but 1 file couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead).");
}
{ // some tiles damaged: the fog that did decode shows, with the count beside it
  assert.equal(status({ source: "zip", tiles: 4, added: 4, corrupt: 1, readErr: 0 }), "4 tiles loaded ✓, but 1 tile could not be read (damaged files).");
  assert.equal(status({ source: "folder", tiles: 4, added: 4, corrupt: 3, readErr: 0 }), "4 tiles loaded ✓, but 3 tiles could not be read (damaged files).");
  assert.equal(status({ source: "folder", tiles: 4, added: 4, corrupt: 3, readErr: 2 }),
    "4 tiles loaded ✓, but 3 tiles could not be read (damaged files) and 2 files couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead).");
}
{ // nothing decoded and some damaged: damaged, not "not found"
  assert.equal(status({ source: "folder", tiles: 0, added: 0, corrupt: 2, readErr: 0 }),
    "None of the fog tiles could be read: 2 damaged files. Try copying your Sync folder again.");
  assert.equal(status({ source: "zip", tiles: 0, added: 0, corrupt: 1, readErr: 0 }),
    "None of the fog tiles could be read: 1 damaged file. Try making your backup again.");
  assert.equal(status({ source: "folder", tiles: 0, added: 0, corrupt: 2, readErr: 1 }),
    "None of the fog tiles could be read: 2 damaged files. Also 1 file couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead). Try copying your Sync folder again.");
}
{ // nothing decoded and nothing damaged: the not-found texts, and the read-error text when a file could not be read
  assert.equal(status({ source: "folder", tiles: 0, added: 0, corrupt: 0, readErr: 0 }), "No fog tiles found. Did you pick the Sync folder?");
  assert.equal(status({ source: "zip", tiles: 0, added: 0, corrupt: 0, readErr: 0 }), "No fog tiles found in that .zip. Make sure it contains your Sync folder.");
  assert.equal(status({ source: "folder", tiles: 0, added: 0, corrupt: 0, readErr: 3 }),
    "Couldn't read the files. If this folder lives in Google Drive or iCloud, it may not be downloaded to the phone. Download your backup and load the .zip instead.");
}

// ---- the counting
const env = () => ({ fogMap: new FogParser.FogMap(), inflate: (b) => zlib.inflateSync(Buffer.from(b)), parseTileId: FogParser.parseTileId });
{ // a tile name decodes, a damaged one is counted, a file that is no tile's is ignored without being counted
  const e = env(), t = ImportMessages.tally();
  ImportMessages.decode(t, good[0], goodBytes(good[0]), e);
  ImportMessages.decode(t, nameOf(1), cut(nameOf(1)).bytes, e);          // body shorter than its header: addTile throws
  ImportMessages.decode(t, nameOf(2), junkTile(nameOf(2)).bytes, e);     // inflate throws
  ImportMessages.decode(t, ".DS_Store", Buffer.from("junk"), e);          // no tile's name
  ImportMessages.decode(t, "Settings.plist", Buffer.from("junk"), e);
  assert.equal(t.added, 1);
  assert.equal(t.corrupt, 2);
  assert.deepEqual([...t.classes].sort(), ["Error"]);
  assert.doesNotMatch(JSON.stringify([...t.classes]), /test|lltk/, "the class names only, never a tile name");
}
{ // a thrown string (pako throws its message) is counted by its type, never by its text
  const t = ImportMessages.tally();
  ImportMessages.decode(t, nameOf(3), Buffer.alloc(3), { fogMap: new FogParser.FogMap(), inflate: () => { throw "incorrect header check test-tile-name"; }, parseTileId: FogParser.parseTileId });
  assert.equal(t.corrupt, 1);
  assert.deepEqual([...t.classes], ["string"]);
}

// ---- the page's loaders, lifted out of main.js
const src = fs.readFileSync(path.join(__dirname, "..", "app", "src", "main.js"), "utf8");
function fnText(name) {
  const start = src.search(new RegExp(`^ {2}(async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `${name} not found in main.js`);
  return src.slice(start, src.indexOf("\n  }\n", start) + 4);
}
function loaders(files, unzip) {
  const shown = [], warns = [];
  const fogMap = new FogParser.FogMap();
  const importStats = { corrupt: 0 };
  const calls = { fog: 0 };
  const scope = {
    fogMap, importStats, ImportMessages, FogParser,
    console: { warn: (...a) => warns.push(a) },
    pako: { inflate: (b) => zlib.inflateSync(Buffer.from(b)) },
    FogZip: { unzip: unzip || (() => files.map((f) => ({ name: "Sync/" + f.name, data: f.bytes }))) },
    map: { fitBounds() {} }, fogChanged() { calls.fog++; },
    setLoad: (m) => shown.push(m),
  };
  const names = Object.keys(scope);
  const warnLine = src.match(/^ {2}const warnDamaged = .*$/m);
  assert.ok(warnLine, "main.js declares warnDamaged");
  const envLine = src.match(/^ {2}const decodeEnv = .*$/m); // the one that ships, run against the scope's pako and map
  assert.ok(envLine, "main.js declares decodeEnv");
  const make = new Function(...names, `
    ${envLine[0]}
    ${warnLine[0]}
    ${fnText("finishLoad")}
    ${fnText("loadFromInput")}
    ${fnText("loadFromZip")}
    return { loadFromInput, loadFromZip };`);
  return { api: make(...names.map((k) => scope[k])), shown, warns, fogMap, importStats, calls };
}
const asFile = (f) => ({ name: f.name, arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) });
const zipFile = { arrayBuffer: async () => new ArrayBuffer(0) };
const last = (r) => r.shown[r.shown.length - 1];

(async () => {
  for (const source of ["folder", "zip"]) {
    const run = async (files, extra) => {
      const r = loaders(files);
      if (source === "folder") await r.api.loadFromInput(files.map(asFile).concat(extra || []));
      else await r.api.loadFromZip(zipFile);
      return r;
    };
    { // all good: the plain tile count, nothing logged, nothing counted
      const r = await run([goodTile(good[0]), goodTile(good[1])]);
      assert.equal(last(r), "2 tiles loaded ✓", source);
      assert.equal(r.calls.fog, 1, "the fog is redrawn once");
      assert.equal(r.importStats.corrupt, 0);
      assert.deepEqual(r.warns, []);
    }
    { // junk files beside good tiles (a .DS_Store, a plist) do not turn a good import into a damaged one
      const r = await run([goodTile(good[0]), { name: ".DS_Store", bytes: Buffer.from("junk") }, { name: "Settings.plist", bytes: Buffer.from("junk") }]);
      assert.equal(last(r), "1 tiles loaded ✓", source);
      assert.equal(r.importStats.corrupt, 0);
      assert.deepEqual(r.warns, []);
    }
    { // some damaged: the good ones show, the count is beside them, one log line with classes only
      const r = await run([goodTile(good[0]), cut(nameOf(1)), junkTile(nameOf(2))]);
      assert.equal(last(r), "1 tiles loaded ✓, but 2 tiles could not be read (damaged files).", source);
      assert.equal(r.calls.fog, 1, "the decoded fog is still shown");
      assert.equal(r.fogMap.tileCount, 1);
      assert.equal(r.importStats.corrupt, 2);
      assert.equal(r.warns.length, 1);
      assert.doesNotMatch(JSON.stringify(r.warns), /test|lltk|zz/, "no tile or file name in the log");
    }
    { // all damaged: worded as damaged, not as not found
      const r = await run([cut(nameOf(1)), junkTile(nameOf(2))]);
      assert.match(last(r), /^None of the fog tiles could be read: 2 damaged files\./, source);
      assert.doesNotMatch(last(r), /No fog tiles found/);
      assert.equal(r.fogMap.tileCount, 0);
      assert.equal(r.calls.fog, 0);
    }
    { // none present: the not-found text, no log
      const r = await run([{ name: "notes.txt", bytes: Buffer.from("hello") }]);
      assert.equal(last(r), source === "folder" ? "No fog tiles found. Did you pick the Sync folder?" : "No fog tiles found in that .zip. Make sure it contains your Sync folder.");
      assert.deepEqual(r.warns, []);
    }
    { // a second load counts from zero
      const r = loaders([cut(nameOf(1))]);
      if (source === "folder") {
        await r.api.loadFromInput([asFile(cut(nameOf(1)))]);
        assert.equal(r.importStats.corrupt, 1);
        await r.api.loadFromInput([asFile(goodTile(good[0]))]);
        assert.equal(r.importStats.corrupt, 0, "a good load after a damaged one starts from zero");
      } else {
        await r.api.loadFromZip(zipFile);
        r.importStats.corrupt = 99; // a count a previous load left on the page
        await r.api.loadFromZip(zipFile);
        assert.equal(r.importStats.corrupt, 1, "the count is per load");
      }
    }
  }
  { // a second import into the same map shows the map's total, not this import's count
    const r = loaders([goodTile(good[1])]);
    r.fogMap.addTile(good[0], zlib.inflateSync(goodBytes(good[0])));
    await r.api.loadFromZip(zipFile);
    assert.equal(last(r), "2 tiles loaded ✓");
  }
  { // an unzip that fails clears the count a previous load left
    const r = loaders([], () => { throw new Error("bad zip"); });
    r.importStats.corrupt = 99;
    await r.api.loadFromZip(zipFile);
    assert.equal(r.importStats.corrupt, 0);
    assert.match(last(r), /^Couldn't open that \.zip/);
  }
  { // folder only: a file that could not be read beside damaged ones
    const unreadable = { name: "cloud-only", arrayBuffer: async () => { throw new Error("not downloaded"); } };
    const r = loaders([]);
    await r.api.loadFromInput([asFile(cut(nameOf(1))), unreadable]);
    assert.equal(last(r), "None of the fog tiles could be read: 1 damaged file. Also 1 file couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead). Try copying your Sync folder again.");
    const r2 = loaders([]);
    await r2.api.loadFromInput([asFile(goodTile(good[0])), asFile(cut(nameOf(1))), unreadable]);
    assert.equal(last(r2), "1 tiles loaded ✓, but 1 tile could not be read (damaged files) and 1 file couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead).");
  }
  { // the page loads the helper before main.js, and the phone's hook reads the count in a task queued by unzip, so
    // nothing may yield to the event loop between the unzip and the count being published
    const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
    const at = (n) => html.indexOf(`src="src/${n}"`);
    assert.ok(at("importMessages.js") > 0 && at("importMessages.js") < at("main.js"), "importMessages.js loads before main.js");
    const zipFn = fnText("loadFromZip");
    assert.doesNotMatch(zipFn.slice(zipFn.indexOf("return; }\n") + 1), /\bawait\b|setTimeout|requestAnimationFrame/, "loadFromZip yields after the unzip returned");
  }
  { // main.js exposes the count to the phone adapter, and logs through the helper's tally only
    assert.match(src, /lastImport: importStats/);
    for (const f of ["loadFromInput", "loadFromZip"]) {
      assert.doesNotMatch(fnText(f), /catch \(e\) \{\}/, `${f} counts a failed tile instead of dropping it`);
      assert.doesNotMatch(fnText(f), /console\.\w+\([^)]*(\.name|\bf\b|\bent\b|\bbase\b)/, `${f} logs no file or tile name`);
    }
  }
  console.log("import-messages.test.js ok");
})().catch((e) => { console.error(e); process.exit(1); });
