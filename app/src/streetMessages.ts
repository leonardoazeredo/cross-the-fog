// What the page says about a street download: its progress, and why a failed one failed. Built only from
// the error's reason, its cause's reason, tile counts and retry time, never a message: that can hold a
// server remark or a tile number, which locates the area.
const GENERIC = "Couldn't download the street map. Try again in a minute.";
const BLOCKED_ADVICE = "Try another network, or try again tomorrow";

// " in about 30 s" from a time on the clock of `now` (retryAt, or progress's waitUntil), or null without a time or a clock. Rounded up to 10 s because
// the text is read a while after it is set and an exact count would promise too early; a wait past
// two minutes reads better in minutes.
function wait(retryAt: number | null | undefined, now: number | undefined): string | null {
  if (!retryAt || !Number.isFinite(now)) return null;
  const s = Math.max(10, Math.ceil((retryAt - (now as number)) / 10000) * 10);
  return s <= 120 ? ` in about ${s} s` : ` in about ${Math.ceil(s / 60)} min`;
}

interface Facts {
  reason?: string;
  done?: number;
  total?: number;
  retryAt?: number;
  cause?: { reason?: string } | null;
}

// Why the run stopped short, from the first failure's reason.
function stopped(cause: Facts["cause"]): string {
  const reason = cause && cause.reason;
  return reason === "stalled"
    ? "the server got too slow"
    : reason === "offline"
      ? "the connection dropped"
      : reason === "blocked"
        ? "the server blocked this network for today"
        : "the server stopped";
}

// err: a rejection from StreetIndex.ensureRects ({reason, done, total, retryAt, cause}), what
// StreetIndex.downloadFacts keeps of one, or anything else thrown on the way; now: the clock retryAt is on.
export function describe(err: unknown, now?: number): string {
  const facts = err as Facts | null | undefined;
  const reason = facts && facts.reason,
    retryAt = facts && facts.retryAt;
  if (reason === "busy")
    return "The street servers are busy. Try again" + (wait(retryAt, now) || " in a minute") + ".";
  if (reason === "blocked")
    return (
      "The street server has blocked this network for today: it caps each network's daily use. " +
      BLOCKED_ADVICE +
      "."
    );
  if (reason === "stalled")
    return (
      "The street server is slow to answer. Try again" +
      (wait(retryAt, now) || " in a few minutes") +
      "."
    );
  if (reason === "offline")
    return "You're offline. This area's street map is downloaded once and kept on this device.";
  if (
    facts &&
    reason === "streets-partial" &&
    Number.isInteger(facts.done) &&
    Number.isInteger(facts.total)
  ) {
    const again =
      facts.cause && facts.cause.reason === "blocked"
        ? BLOCKED_ADVICE
        : "Try again" + (wait(retryAt, now) || "");
    return `Got ${facts.done} of ${facts.total} pieces of the street map before ${stopped(facts.cause)}. ${again}: only the rest is downloaded.`;
  }
  return GENERIC;
}

// waitUntil: when the download asks again after a busy answer, a time on the same clock as `now`;
// set only while the download waits that out.
export function progress(done?: number, total?: number, waitUntil?: number, now?: number): string {
  const counted = Number.isInteger(done) && Number.isInteger(total);
  const again = waitUntil ? wait(waitUntil, now) : null;
  if (again)
    return (
      "The street servers are busy. Trying again" +
      again +
      "…" +
      (counted ? ` (${done} of ${total})` : "")
    );
  return counted ? `Getting the street map, ${done} of ${total}…` : "Getting the street map…";
}

// What the page's `window.StreetMessages` is made of.
export const StreetMessages = { describe, progress };
