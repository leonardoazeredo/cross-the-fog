import type { NativeToWeb, RouteRecord } from "../bridge/protocol.js";
import { COPY } from "../copy.js";
import type { RouteStore } from "../history/types.js";
import type { LinkStatus, WatchLink } from "../link/types.js";
import { warnClass } from "./warn.js";

export interface SendDeps {
  link: Pick<WatchLink, "queueRoute" | "status" | "discardUnreadableRoutes" | "on">;
  routes: Pick<RouteStore, "save" | "get" | "markSent">;
  send(msg: NativeToWeb): void;
  /** The SHA-256 of a GPX as UTF-8 bytes, 64 lowercase hex digits (`gpxRevision`). */
  revisionOf(gpx: string): Promise<string>;
}

export interface SendFlow {
  /** Never rejects: a failed save or queue reaches the page as a `failed` route status. */
  sendRoute(route: RouteRecord): Promise<void>;
  /** Tells the page the current link status, for a page that has just loaded. */
  sendStatus(): Promise<void>;
  /** Starts forwarding link events to the page; returns the function that stops it. */
  start(): () => void;
}

const warn = (what: string, e: unknown) => warnClass("send", what, e);

type RouteState = Extract<NativeToWeb, { type: "routeStatus" }>["state"];

function routeStatus(
  routeId: string,
  state: RouteState,
  extra: { why?: string | undefined; revision?: string | undefined } = {},
): NativeToWeb {
  return {
    v: 1,
    type: "routeStatus",
    routeId,
    state,
    ...(extra.why === undefined ? {} : { why: extra.why }),
    ...(extra.revision === undefined ? {} : { revision: extra.revision }),
  };
}

function linkStatus({ paired, reachable }: LinkStatus, unsentRoutes = 0): NativeToWeb {
  return {
    v: 1,
    type: "linkStatus",
    paired,
    reachable,
    ...(unsentRoutes > 0 ? { unsentRoutes } : {}),
  };
}

export function createSendFlow(deps: SendDeps): SendFlow {
  const { link, routes } = deps;

  function send(msg: NativeToWeb): void {
    try {
      deps.send(msg);
    } catch (e) {
      warn("could not reach the page", e);
    }
  }

  // One at a time: a confirmation reads the stored route, waits for its hash and marks it, and a send that
  // stores an edited route in that gap would be marked sent by the earlier revision's confirmation.
  let tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  }

  async function isStored(routeId: string, revision: string): Promise<boolean> {
    const stored = await routes.get(routeId);
    return stored !== null && (await deps.revisionOf(stored.gpx)) === revision;
  }

  return {
    async sendRoute(route) {
      let revision: string | undefined;
      try {
        revision = await deps.revisionOf(route.gpx);
        // A page whose hash differs from the phone's would wait on a status it can never match.
        if (route.revision !== undefined && route.revision !== revision) {
          throw new Error("route revision is not the hash of its GPX");
        }
        await exclusive(async () => {
          await routes.save(route);
          await link.queueRoute(route);
        });
      } catch (e) {
        warn("could not queue a route", e);
        // The page's own revision when it sent one, so a refusal for a wrong hash is a status it can match.
        send(
          routeStatus(route.id, "failed", {
            why: COPY.routeNotSent,
            revision: route.revision ?? revision,
          }),
        );
        return;
      }
      send(routeStatus(route.id, "waiting", { revision }));
    },

    async sendStatus() {
      let status: LinkStatus;
      try {
        status = await link.status();
      } catch (e) {
        warn("could not read the link status", e);
        return;
      }
      // After the status is read, so a status that cannot be read leaves the routes for the next page
      // load instead of removing them with nobody told. A failure here only costs the page the count: the status is still sent.
      let unsent = 0;
      try {
        unsent = await link.discardUnreadableRoutes();
      } catch (e) {
        warn("could not remove the routes that cannot be opened", e);
      }
      send(linkStatus(status, unsent));
    },

    start() {
      const offRoute = link.on("routeSaved", ({ routeId, revision }) => {
        void (async () => {
          // The watch has the route whether or not the record could be marked, so the page hears it either way.
          // A revision that is not the stored route's is a late answer for an earlier send of the same id, so
          // it does not mark the edited route sent; one with no revision is taken for the route as it is.
          try {
            await exclusive(async () => {
              if (revision === undefined || (await isStored(routeId, revision))) {
                await routes.markSent(routeId);
              }
            });
          } catch (e) {
            warn("could not mark a route sent", e);
          }
          send(routeStatus(routeId, "onWatch", { revision }));
        })();
      });
      const offStatus = link.on("linkStatus", (status) => send(linkStatus(status)));
      return () => {
        offRoute();
        offStatus();
      };
    },
  };
}
