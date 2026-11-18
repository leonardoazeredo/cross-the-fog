import { warnClass } from "../flows/warn.js";
import { reportDropped } from "./dropped.js";
import {
  inspectWebToNative,
  isTrustedSource,
  type NativeToWeb,
  type WebToNative,
} from "./protocol.js";

interface WebMessageDeps {
  send: (msg: NativeToWeb) => void;
  abandonExport: (exportId: string) => void | Promise<void>;
  onMessage: (msg: WebToNative) => void | Promise<void>;
}

// The WebView's onMessage has no caller to catch a throw and nothing awaits a promise from it, so a failure
// here would be lost (a rejection unhandled and unlogged, a throw escaping the event). Only the class is
// logged: a message can hold a route, an id or a position.
function guarded(what: string, run: () => void | Promise<void>): void {
  try {
    Promise.resolve(run()).catch((e: unknown) => warnClass("bridge", what, e));
  } catch (e) {
    warnClass("bridge", what, e);
  }
}

// Lives outside WebShell, which no unit test can render, so the step that hands a dropped message to
// reportDropped (and so keeps the page from waiting on it) can be tested. A message from another origin
// is silent: it gets no log and no answer.
export function createWebMessageHandler(
  deps: WebMessageDeps,
): (event: { url: string; data: string }) => void {
  return ({ url, data }) => {
    if (!isTrustedSource(url)) return;
    const parsed = inspectWebToNative(data);
    if (!parsed.ok) {
      reportDropped(
        parsed.drop,
        (msg) => guarded("reply to a dropped message failed", () => deps.send(msg)),
        (id) => guarded("abandon a dropped export failed", () => deps.abandonExport(id)),
      );
      return;
    }
    const { msg } = parsed;
    guarded("page message failed", () => deps.onMessage(msg));
  };
}
