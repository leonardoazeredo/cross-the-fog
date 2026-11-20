import { readdirSync } from "node:fs";
import { join } from "node:path";

// Every offline Node test in bench/, by name: bench/run.js and compare.js are not among them, they need the
// owner's Sync/ folder and the saved baseline.
// `list` is the folder reader, a parameter so a test can hand it names in an order the file system never returns.
export function benchTests(
  benchDir: string,
  list: (dir: string) => string[] = readdirSync,
): string[] {
  return list(benchDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join(benchDir, name));
}
