import { expect, it, vi } from "vitest";
import { HistoryKeyLostError, HistoryOpenFailedError } from "../../../src/db/openHistory.js";

let openFails = false;

// The real module opens SQLCipher through expo; only the open's outcome matters here.
vi.mock("../../../src/platform/database.js", async () => {
  const { createGate } = await import("../../../src/db/gate.js");
  return {
    createDatabase: async () => {
      if (openFails) throw new Error("disk at /data/user/0 is full");
      return { kind: "keyLost" };
    },
    historyGate: createGate(),
  };
});

const { createHistoryStores } = await import("../../../src/platform/historyStores.js");

it("rejects every store call with HistoryKeyLostError while the key is lost", async () => {
  const { activities, routes } = createHistoryStores();
  await expect(activities.list()).rejects.toBeInstanceOf(HistoryKeyLostError);
  await expect(activities.delete("a")).rejects.toBeInstanceOf(HistoryKeyLostError);
  await expect(routes.save({} as never)).rejects.toBeInstanceOf(HistoryKeyLostError);
});

it("rejects with HistoryOpenFailedError, carrying the failure as its cause, when the open fails", async () => {
  openFails = true;
  try {
    const { activities } = createHistoryStores();
    const error = await activities.list().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HistoryOpenFailedError);
    expect((error as Error).message).not.toContain("/data");
    expect(((error as Error).cause as Error).message).toContain("disk");
  } finally {
    openFails = false;
  }
});
