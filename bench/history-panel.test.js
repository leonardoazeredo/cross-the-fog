// HistoryPanel's pure helpers (how an activity summary reads on a card) and the Send button's chip,
// over a stand-in button; no DOM, no network.
//   node bench/history-panel.test.js
"use strict";
const assert = require("node:assert/strict");
global.window = global;
require("../app/src/history.js");
const { formatDuration, formatDistance, paceSecondsPerKm, formatPace, statLines, formatStart } = global.HistoryPanel;

// duration
{
  assert.equal(formatDuration(3725), "1 h 02 min");
  assert.equal(formatDuration(3600), "1 h 00 min");
  assert.equal(formatDuration(3599.7), "1 h 00 min", "rounds to the minute, carrying into the hour");
  assert.equal(formatDuration(2700), "45 min");
  assert.equal(formatDuration(59), "59 s");
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(-5), "0 s", "a negative duration never prints a minus");
  assert.equal(formatDuration(NaN), "–", "a missing figure prints a dash");
}

// distance
{
  assert.equal(formatDistance(4321, "metric"), "4.3 km");
  assert.equal(formatDistance(1000, "metric"), "1.0 km");
  assert.equal(formatDistance(850, "metric"), "850 m");
  assert.equal(formatDistance(4321, "imperial"), "2.7 mi");
  assert.equal(formatDistance(80, "imperial"), "262 ft");
  assert.equal(formatDistance(0, "metric"), "0 m");
}

// pace
{
  assert.equal(paceSecondsPerKm(5000, 1800), 360);
  assert.equal(paceSecondsPerKm(50, 600), null, "too short a distance for a pace");
  assert.equal(paceSecondsPerKm(5000, 0), null);
  assert.equal(formatPace(360, "metric"), "6:00 /km");
  assert.equal(formatPace(372, "metric"), "6:12 /km");
  assert.equal(formatPace(360, "imperial"), "9:39 /mi");
  assert.equal(formatPace(null, "metric"), null);
}

// start time
{
  const s = formatStart("2026-03-03T10:05:00Z", "en-GB", "UTC");
  assert.match(s, /2026/);
  assert.match(s, /10:05/);
  assert.equal(formatStart("not a date"), "", "an unreadable date prints nothing");
}

// the lines under a card's title
{
  const base = { id: "11111111-1111-4111-8111-111111111111", startedAt: "2026-03-03T10:00:00Z", endedAt: "2026-03-03T11:02:05Z" };
  const full = { ...base, stats: { durationS: 3725, distanceM: 4321, paceSPerKm: 862, steps: 5400, heartRateAvg: 112.4, heartRateMax: 141 } };
  assert.deepEqual(statLines(full, "metric"), ["4.3 km", "1 h 02 min", "14:22 /km", "5400 steps", "♥ 112 avg · 141 max"]);

  const noSteps = { ...base, stats: { durationS: 1800, distanceM: 5000 } };
  const lines = statLines(noSteps, "metric");
  assert.deepEqual(lines, ["5.0 km", "30 min", "6:00 /km"], "pace falls back to distance over duration");
  assert.ok(!lines.some((l) => /steps/.test(l)), "no steps line without steps");
  assert.ok(!lines.some((l) => /♥/.test(l)), "no heart line without heart rate");

  const noPace = { ...base, stats: { durationS: 600, distanceM: 40 } };
  assert.deepEqual(statLines(noPace, "imperial"), ["131 ft", "10 min"], "less ground than the minimum for a pace has none");

  const onlyAvg = { ...base, stats: { durationS: 1800, distanceM: 5000, heartRateAvg: 98 } };
  assert.ok(statLines(onlyAvg, "metric").includes("♥ 98 avg"), "heart rate with only an average");
}

// Send to watch: the chip never stays blank after a tap the phone did not take or never answered
{
  const { createSendControl, REPLY_TIMEOUT_MS } = global.HistoryPanel;
  assert.ok(REPLY_TIMEOUT_MS > 0);
  const timers = [];
  const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout, realError = console.error;
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
  global.clearTimeout = (h) => { if (timers[h - 1]) timers[h - 1].live = false; };
  const fire = () => timers.splice(0).forEach((t) => { if (t.live) t.fn(); });
  function control(send) {
    let onClick = null;
    const btn = { disabled: true, addEventListener: (_, fn) => { onClick = fn; } }, chip = { textContent: "" };
    const route = { has: true, revision: 1, gpx: "<gpx/>" };
    const sentRecords = [];
    const ctl = createSendControl({
      button: btn, chip, getRecord: () => ({ id: "r1", gpx: route.gpx }), hasRoute: () => route.has, revision: () => route.revision, canSend: () => true,
      // stands in for Sha256.hex: any pure function of the text shows the chip comparing contents
      contentHash: (text) => "hash:" + text,
      send: (rec) => { sentRecords.push(rec); send(rec); }
    });
    return { ctl, chip, btn, route, sentRecords, tap: () => onClick() };
  }
  try {
    const errors = [];
    console.error = (...a) => errors.push(a.join(" "));
    const thrown = control(() => { throw new TypeError("bridge gone"); });
    thrown.tap();
    assert.equal(thrown.chip.textContent, "Could not send", "a send that throws reads as failed");
    assert.ok(errors.some((e) => /TypeError/.test(e)), "the error class is logged");

    const silent = control(() => {});
    silent.tap();
    assert.equal(silent.chip.textContent, "");
    assert.ok(timers.some((t) => t.live && t.ms === REPLY_TIMEOUT_MS), "the tap starts the reply timeout");
    fire();
    assert.equal(silent.chip.textContent, "Could not send", "no answer from the phone reads as failed");

    const answered = control(() => {});
    answered.tap();
    answered.ctl.routeStatus({ routeId: "r1", state: "waiting" });
    fire();
    assert.equal(answered.chip.textContent, "Waiting for watch", "an answered send is never timed out");

    // routes the phone had to drop: the line shows when no route state does, outranks "Not paired" and is
    // outranked by the status of a route that was sent; sending again clears it
    const lost = control(() => {});
    lost.ctl.linkStatus({ paired: false, reachable: false });
    assert.equal(lost.chip.textContent, "Not paired");
    lost.ctl.linkStatus({ paired: false, reachable: false, unsentRoutes: 1 });
    assert.equal(lost.chip.textContent, "A route could not be sent. Send it again.");
    lost.ctl.linkStatus({ paired: true, reachable: false });
    assert.equal(lost.chip.textContent, "A route could not be sent. Send it again.", "a later status without the count keeps the line");
    lost.ctl.linkStatus({ paired: true, reachable: false, unsentRoutes: 2 });
    assert.equal(lost.chip.textContent, "3 routes could not be sent. Send them again.", "counts add up until the user sends again");
    lost.tap();
    assert.equal(lost.chip.textContent, "", "sending again clears the line");
    lost.ctl.routeStatus({ routeId: "r1", state: "waiting" });
    assert.equal(lost.chip.textContent, "Waiting for watch");
    lost.ctl.linkStatus({ paired: true, reachable: false, unsentRoutes: 1 });
    assert.equal(lost.chip.textContent, "Waiting for watch", "a route's own status outranks the line");
    lost.ctl.linkStatus({ paired: true, reachable: false, unsentRoutes: 0 });
    lost.ctl.linkStatus({ paired: true, reachable: false, unsentRoutes: -4 });
    lost.ctl.linkStatus({ paired: true, reachable: false, unsentRoutes: "2" });
    lost.route.revision++;
    lost.ctl.update();
    assert.equal(lost.chip.textContent, "A route could not be sent. Send it again.", "an edit blanks the route's status and the line shows again, once; zero, negative and text counts add nothing");

    // The revision is the hash of the GPX of this send, so a late answer for an earlier send of the same
    // route id (edited and sent again) cannot say "On the watch" for the new one.
    const sendTwice = control(() => {});
    sendTwice.tap();
    assert.equal(sendTwice.sentRecords[0].revision, "hash:<gpx/>", "the record carries the hash of its GPX");
    assert.equal(sendTwice.sentRecords[0].gpx, "<gpx/>");
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "waiting", revision: "hash:<gpx/>" });
    assert.equal(sendTwice.chip.textContent, "Waiting for watch");
    sendTwice.route.gpx = "<gpx v='2'/>"; sendTwice.route.revision++;
    sendTwice.ctl.update();
    assert.equal(sendTwice.chip.textContent, "", "an edit blanks the chip");
    sendTwice.tap();
    assert.equal(sendTwice.sentRecords[1].revision, "hash:<gpx v='2'/>");
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "onWatch", revision: "hash:<gpx/>" });
    assert.equal(sendTwice.chip.textContent, "", "a late answer for v1 before the phone has answered v2 is ignored");
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "waiting", revision: "hash:<gpx v='2'/>" });
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "onWatch", revision: "hash:<gpx/>" });
    assert.equal(sendTwice.chip.textContent, "Waiting for watch", "a late onWatch for v1 does not say On the watch once v2 is waiting");
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "failed", revision: "hash:<gpx/>" });
    assert.equal(sendTwice.chip.textContent, "Waiting for watch", "nor does a late failure of v1");
    sendTwice.ctl.routeStatus({ routeId: "r1", state: "onWatch", revision: "hash:<gpx v='2'/>" });
    assert.equal(sendTwice.chip.textContent, "On the watch", "the answer for v2 does");

    // A status with no revision (a phone or watch build from before revisions) is matched by route id alone,
    // as it was; a revision that is present must match, whatever its shape.
    const legacy = control(() => {});
    legacy.tap();
    legacy.ctl.routeStatus({ routeId: "r1", state: "onWatch" });
    assert.equal(legacy.chip.textContent, "On the watch", "no revision: accepted by id");
    const odd = control(() => {});
    odd.tap();
    for (const revision of ["", "x", 5, {}]) odd.ctl.routeStatus({ routeId: "r1", state: "onWatch", revision });
    assert.equal(odd.chip.textContent, "", "a revision that is present and not this send's is ignored");
    odd.ctl.routeStatus({ routeId: "r1", state: "onWatch", revision: null });
    assert.equal(odd.chip.textContent, "On the watch", "null reads as absent, like JSON null for any optional field");

    // the button follows hasRoute without building a record; an edit (a new revision) blanks the chip
    const edited = control(() => {});
    edited.ctl.update();
    assert.equal(edited.btn.disabled, false);
    edited.tap();
    edited.ctl.routeStatus({ routeId: "r1", state: "onWatch" });
    assert.equal(edited.chip.textContent, "On the watch");
    edited.route.revision++;
    edited.ctl.update();
    assert.equal(edited.chip.textContent, "", "an edit blanks the chip");
    edited.ctl.routeStatus({ routeId: "r1", state: "onWatch" });
    assert.equal(edited.chip.textContent, "", "a status for the route as it was is ignored");
    edited.route.has = false;
    edited.ctl.update();
    assert.equal(edited.btn.disabled, true);
  } finally {
    global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout; console.error = realError;
  }
}

console.log("history-panel.test.js ok");
