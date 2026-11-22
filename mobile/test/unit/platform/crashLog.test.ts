import { beforeEach, expect, it, vi } from "vitest";

const disk = new Map<string, string>();

vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
    }
    async write(content: string, options?: { append?: boolean }) {
      disk.set(this.uri, (options?.append ? (disk.get(this.uri) ?? "") : "") + content);
    }
  }
  return { File, Paths: { document: "doc" } };
});

beforeEach(() => disk.clear());

async function logged(error: unknown): Promise<string[]> {
  const { logCrash } = await import("../../../src/platform/crashLog.js");
  await logCrash(error);
  return (disk.get("doc/crash.log") ?? "").trimEnd().split("\t");
}

it("writes the timestamp and the error's class, never its message", async () => {
  const [stamp, name, ...rest] = await logged(
    new TypeError("no street near 48.12345,16.54321 at /data/user/0/x"),
  );
  expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(name).toBe("TypeError");
  expect(rest).toEqual([]);
  expect(disk.get("doc/crash.log") ?? "").not.toMatch(/48\.|16\.|street|\/data/);
});

it("logs a subclass by its own name", async () => {
  class Custom extends Error {
    override name = "GpxError";
  }
  expect((await logged(new Custom("x")))[1]).toBe("GpxError");
});

it("logs unknown for a thrown string, an object, and a name that is not a plain identifier", async () => {
  expect((await logged("at 51.50735"))[1]).toBe("unknown");
  disk.clear();
  expect((await logged({ name: "Sneaky" }))[1]).toBe("unknown");
  disk.clear();
  const odd = new Error("x");
  odd.name = "failed at 48.1234,16.5432";
  expect((await logged(odd))[1]).toBe("unknown");
});
