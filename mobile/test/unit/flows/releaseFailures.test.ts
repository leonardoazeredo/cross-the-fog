import { describe, expect, it } from "vitest";
import {
  createReleaseFailures,
  RELEASE_FAILURE_LIMIT,
} from "../../../src/flows/releaseFailures.js";
import { createMemoryFileStore } from "../../support/memoryFileStore.js";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("release failures", () => {
  it("counts per id and keeps the count in the file, so a new instance goes on from it", async () => {
    const fs = createMemoryFileStore();
    const first = createReleaseFailures(fs);
    expect(await first.record(A)).toBe(1);
    expect(await first.record(A)).toBe(2);
    expect(await first.record(B)).toBe(1);

    const second = createReleaseFailures(fs);
    expect(await second.record(A)).toBe(3);
  });

  it("counts the ids at or past the limit", async () => {
    const failures = createReleaseFailures(createMemoryFileStore());
    for (let i = 0; i < RELEASE_FAILURE_LIMIT; i++) await failures.record(A);
    await failures.record(B);
    expect(await failures.stuck()).toBe(1);
  });

  it("forgets an id, and everything not in the keep set", async () => {
    const failures = createReleaseFailures(createMemoryFileStore());
    await failures.record(A);
    await failures.record(B);
    await failures.forget(A);
    expect(await failures.record(A)).toBe(1);
    await failures.prune(new Set([B]));
    expect(await failures.record(A)).toBe(1);
    expect(await failures.record(B)).toBe(2);
  });

  it("reads a file that is not a map of counts as empty", async () => {
    for (const text of ["not json", "[1,2]", '{"a":"x","b":-1,"c":1.5}']) {
      const fs = createMemoryFileStore();
      await fs.createText("release-failures.json", text);
      expect(await createReleaseFailures(fs).stuck()).toBe(0);
    }
  });

  it("leaves no file once nothing is counted", async () => {
    const fs = createMemoryFileStore();
    const failures = createReleaseFailures(fs);
    await failures.record(A);
    await failures.forget(A);
    expect(await fs.list()).toEqual([]);
  });
});
