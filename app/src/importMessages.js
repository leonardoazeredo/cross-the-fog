// ImportMessages: what the page says about an import (a Sync folder or a .zip), and the decode step that counts
// the tiles which could not be read. Pure: no DOM, no Leaflet; main.js owns the status line and the log.
(function (global) {
  const plural = (n, one, many) => (n === 1 ? one : many);

  // files kept only in the cloud are the usual reason a folder file cannot be read
  const cloudNote = (n) => `${n} file${plural(n, "", "s")} couldn't be read (files kept only in the cloud aren't downloaded, so try the .zip instead)`;

  // r: {source: "folder" | "zip", tiles (the map's count after the import), added (tiles this import decoded),
  //     corrupt (tile files that could not be decoded), readErr (files the browser could not read at all)}
  function status(r) {
    const { source, tiles, added, corrupt, readErr } = r;
    const damaged = `${corrupt} tile${plural(corrupt, "", "s")} could not be read (damaged files)`;
    if (added > 0) {
      const base = `${tiles} tiles loaded ✓`;
      if (corrupt > 0 && readErr > 0) return `${base}, but ${damaged} and ${cloudNote(readErr)}.`;
      if (corrupt > 0) return `${base}, but ${damaged}.`;
      if (readErr > 0) return `${base}, but ${cloudNote(readErr)}.`;
      return base;
    }
    // nothing decoded: damaged files say so, so nobody goes looking for another folder
    if (corrupt > 0) {
      const retry = source === "zip" ? "Try making your backup again." : "Try copying your Sync folder again.";
      return `None of the fog tiles could be read: ${corrupt} damaged file${plural(corrupt, "", "s")}.${readErr > 0 ? ` Also ${cloudNote(readErr)}.` : ""} ${retry}`;
    }
    if (readErr > 0) return "Couldn't read the files. If this folder lives in Google Drive or iCloud, it may not be downloaded to the phone. Download your backup and load the .zip instead.";
    return source === "zip" ? "No fog tiles found in that .zip. Make sure it contains your Sync folder." : "No fog tiles found. Did you pick the Sync folder?";
  }

  const tally = () => ({ added: 0, corrupt: 0, classes: new Set() });

  // A tile's file name is its id's own name (the id's letters plus a checksum of the id), so a plain word such as
  // "Snapshot" or "Config", which parseTileId also reads as an id, is not one.
  function isTileName(name, env) {
    const id = env.parseTileId(name);
    if (id == null) return false;
    try { return env.tileName(id) === name; } catch (e) { return false; } // an id outside the grid has no name
  }

  // Decodes one file into env.fogMap and counts it in t. A file whose name is no tile's is not a tile (a .DS_Store, a
  // plist, a file called "Snapshot") and is left alone, so it never counts as damage; a tile's own file that cannot be
  // inflated or parsed is counted as corrupt, and only its error's class is kept (a thrown string counts as "string"):
  // the parser's message names the tile. pako returns nothing, rather than throwing, for a stream cut short, which is
  // the usual shape of a half-copied file, so no data is damage too.
  // env: {fogMap, inflate(bytes) -> Uint8Array | undefined, parseTileId(name) -> id | null, tileName(id) -> name}
  function decode(t, name, bytes, env) {
    if (!isTileName(name, env)) return;
    try {
      const data = env.inflate(bytes);
      if (!data) throw new TypeError("inflate returned no data");
      if (env.fogMap.addTile(name, data)) t.added++;
    } catch (e) {
      t.corrupt++;
      t.classes.add(e && typeof e === "object" && e.name ? String(e.name) : typeof e);
    }
  }

  global.ImportMessages = { status, tally, decode, isTileName };
})(window);
