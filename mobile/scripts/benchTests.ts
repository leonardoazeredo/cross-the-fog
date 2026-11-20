import { readdirSync } from "node:fs";
import { join } from "node:path";

// Every offline Node test in bench/, by name: bench/run.js and compare.js are not among them, they need the
// owner's Sync/ folder and the saved baseline.
export function benchTests(benchDir: string): string[] {
  return readdirSync(benchDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join(benchDir, name));
}
