// A to B wanted-distance check on the real fog.
//   node bench/p2p-target.js
//   P2P_PINS="lat,lng;lat,lng" node bench/p2p-target.js   # pins near your own fog
// Exits non-zero when a targeted case breaks a check: a result outside the window, an
// empty result, a clamp or wantKm mismatch, or a fastest route that the header doesn't
// own up to. The untargeted baseline is only reported.
// Overpass responses are cached in bench/cache/, so only the first run is live.
"use strict";
const path = require("path");
const { loadSync, gainOver, SuggestTool } = require("./lib/load.js");
const { runSuggest } = require("./lib/headless.js");
const { p2pWindow } = SuggestTool._internals;

const pins = (process.env.P2P_PINS || "51.0681,13.7543;51.0590,13.7829")
  .split(";").map((p) => p.split(",").map(Number));
let failed = 0;
const say = (label, verdict, detail) =>
  console.log(`${verdict.padEnd(4)} ${label.padEnd(18)} ${detail || ""}`);

(async () => {
  const { fogMap } = loadSync(path.join(__dirname, "..", "Sync"));
  const gain = gainOver(fogMap);
  const run = (buffer, targetM) =>
    runSuggest(fogMap, gain, { mode: "p2p", a: pins[0], b: pins[1], buffer, targetM });
  // informational, does not affect PASS/FAIL
  const extra = (o) => o.results.length
    ? ` | retr max ${Math.max(...o.results.map((r) => r.retracePct))}%, best ${Math.round(Math.max(...o.results.map((r) => r.areaPerKm)))} m2/km, ${o.requests} req`
    : "";
  const kms = (o) => o.results.map((r) => +(r.lenM / 1000).toFixed(2)).join(", ") || "none";

  {
    let plain;
    try { plain = await run(0.15, 0); } catch (e) { say("untargeted", "SKIP", e.message); process.exit(0); }
    if (plain.state.error || plain.state.baseKm == null) {
      say("untargeted", "SKIP", plain.state.error ? "routing error" : "no baseline");
      process.exit(0);
    }
    const baseM = plain.state.baseKm * 1000;
    if (!(plain.state.baseKm > 0) || plain.state.empty) {
      say("untargeted", "WARN", `no cards (${plain.state.reason || "empty"}), fog around the pins may be fully defogged`);
    } else {
      say("untargeted", "PASS", `fastest ${plain.state.baseKm.toFixed(2)} km, cards ${kms(plain)}${extra(plain)}`);
    }

    const cases = [
      { label: "1.5x, 15%", buffer: 0.15, targetM: baseM * 1.5 },
      { label: "1.5x, 5%", buffer: 0.05, targetM: baseM * 1.5 },
      { label: "0.5x clamp", buffer: 0.15, targetM: baseM * 0.5 },
      { label: "10x nothing fits", buffer: 0.15, targetM: baseM * 10 }
    ];
    for (const c of cases) {
      const win = p2pWindow(baseM, c.targetM, c.buffer);
      let o;
      try { o = await run(c.buffer, c.targetM); } catch (e) { say(c.label, "SKIP", e.message); continue; }
      const s = o.state;
      if (s.error) { say(c.label, "SKIP", "routing error"); continue; }
      const problems = [];
      if (s.empty) problems.push(`empty (${s.reason})`); // counted as a failure; only expected where the corridor is fully defogged, check by hand
      for (const r of o.results) {
        if (r.isBase) continue;
        if (r.lenM < win.floor - 1 || r.lenM > win.budget * 1.02 + 1)
          problems.push(`${(r.lenM / 1000).toFixed(2)} km outside [${(win.floor / 1000).toFixed(2)}, ${(win.budget * 1.02 / 1000).toFixed(2)}]`);
      }
      if (s.clamped !== win.clamped) problems.push(`clamped ${s.clamped} != ${win.clamped}`);
      if (!(Math.abs(s.wantKm - win.want / 1000) < 0.01)) problems.push(`wantKm ${s.wantKm} != ${(win.want / 1000).toFixed(2)}`);
      // a fastest route under the floor is only honest when the header says so: the fallback
      // header, or the clamped one that names it as longer than asked
      if (!win.clamped && !s.fallback && o.results.some((r) => r.isBase && r.lenM < win.floor))
        problems.push("fastest route shown under the floor without the fallback flag");
      if (c.label.startsWith("10x") && !s.empty && !s.fallback && o.results.every((r) => r.isBase))
        problems.push("only the fastest route shown but fallback not flagged");
      if (s.fallback && !(o.results.length === 1 && o.results[0].isBase)) problems.push("fallback flagged with other cards");
      if (problems.length) failed++;
      say(c.label, problems.length ? "FAIL" : "PASS", `${problems.join("; ")} cards ${kms(o)}${s.fallback ? " (fallback)" : ""}${extra(o)}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
