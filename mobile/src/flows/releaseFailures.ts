import type { FileStore } from "../fog/fileStore.js";

/** Passes in which a walk's staged copy could not be released before the page is told. */
export const RELEASE_FAILURE_LIMIT = 3;

const FILE = "release-failures.json";

/** How often each staged walk's release failed, kept in a file so a restart does not start the count over. */
export interface ReleaseFailures {
  /** Counts one more failed pass for the id and returns its count. */
  record(id: string): Promise<number>;
  forget(id: string): Promise<void>;
  /** Drops every id not in `keep`: the staged copy is gone, so there is nothing left to retry. */
  prune(keep: ReadonlySet<string>): Promise<void>;
  /** How many ids have failed at least `RELEASE_FAILURE_LIMIT` passes. */
  stuck(): Promise<number>;
}

export function createReleaseFailures(fs: FileStore): ReleaseFailures {
  async function read(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    let parsed: unknown;
    try {
      parsed = JSON.parse((await fs.readText(FILE)) ?? "{}");
    } catch {
      // A file that does not parse is a lost count, not an error: the next failures start it again.
      return counts;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return counts;
    for (const [id, n] of Object.entries(parsed)) {
      if (typeof n === "number" && Number.isInteger(n) && n > 0) counts.set(id, n);
    }
    return counts;
  }

  // The file store never overwrites, so the old file goes first; a crash between the two loses the counts only.
  async function write(counts: Map<string, number>): Promise<void> {
    await fs.remove(FILE);
    if (counts.size > 0) await fs.createText(FILE, JSON.stringify(Object.fromEntries(counts)));
  }

  return {
    async record(id) {
      const counts = await read();
      const n = (counts.get(id) ?? 0) + 1;
      counts.set(id, n);
      await write(counts);
      return n;
    },
    async forget(id) {
      const counts = await read();
      if (counts.delete(id)) await write(counts);
    },
    async prune(keep) {
      const counts = await read();
      let changed = false;
      for (const id of [...counts.keys()]) {
        if (!keep.has(id)) {
          counts.delete(id);
          changed = true;
        }
      }
      if (changed) await write(counts);
    },
    async stuck() {
      const counts = await read();
      return [...counts.values()].filter((n) => n >= RELEASE_FAILURE_LIMIT).length;
    },
  };
}
