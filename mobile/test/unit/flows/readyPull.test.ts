import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { NativeToWeb } from "../../../src/bridge/protocol.js";
import { createFlows } from "../../../src/flows/compose.js";
import {
  createMemoryActivityStore,
  createMemoryRouteStore,
} from "../../../src/history/memoryStores.js";
import { createFakeWatchLink } from "../../../src/link/fakeWatchLink.js";
import { activity } from "../history/fixtures.js";

// The page learns the activity list and the link status by asking: its "ready" is answered by flows.ready(), and
// nothing is replayed to a listener that registers late (test/adapter/pageApi.test.ts pins that half: a message dispatched before a listener registers is not replayed to it). A message sent while
// nobody listened is lost; the answer to the next ready brings the list and the status back.
it("answers every ready with the list and the link status again, whatever was sent before", async () => {
  const activities = createMemoryActivityStore();
  await activities.add(activity());
  let listening = false;
  const heard: NativeToWeb[] = [];
  const flows = createFlows({
    revisionOf: async (gpx) => createHash("sha256").update(gpx, "utf8").digest("hex"),
    link: createFakeWatchLink(),
    activities,
    routes: createMemoryRouteStore(),
    // A page that has not registered its listeners drops what it is sent.
    send: (m) => {
      if (listening) heard.push(m);
    },
    now: () => 0,
  });

  await flows.ready();
  expect(heard).toEqual([]);

  listening = true;
  await flows.ready();

  expect(heard.map((m) => m.type)).toEqual(expect.arrayContaining(["activities", "linkStatus"]));
  const list = heard.find((m) => m.type === "activities");
  expect(list?.type === "activities" && list.items.map((i) => i.id)).toEqual([activity().id]);
});
