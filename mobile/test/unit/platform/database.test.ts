import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_DB, REPLACED_DB } from "../../../src/backup/replace.js";
import type { NotADatabaseError, SqlDriver } from "../../../src/db/driver.js";
import { checkedKeyHex } from "../../../src/db/keyHex.js";

// File contents by name in the SQLite directory; a move carries the contents, so a test can tell
// which file was opened.
const disk = new Map<string, string>();
const opened: string[] = [];
let openFile: (contents: string) => Promise<SqlDriver>;
let readKey: () => Promise<string>;

vi.mock("expo-file-system", () => ({
  Paths: { document: "doc" },
  File: class {
    readonly name: string;
    constructor(...parts: string[]) {
      this.name = parts.at(-1) ?? "";
    }
    get exists() {
      return disk.has(this.name);
    }
  },
}));
vi.mock("../../../src/platform/backupPlatform.js", () => ({
  createDatabaseFiles: () => ({
    pathOf: (name: string) => name,
    exists: (name: string) => disk.has(name),
    remove: (name: string) => disk.delete(name),
    move(from: string, to: string) {
      disk.set(to, disk.get(from) ?? "");
      disk.delete(from);
    },
  }),
}));
// Hoisted so the factory, rerun by each vi.resetModules, hands out the spy the test checks.
const { resetKeys, KeyUnavailableError } = vi.hoisted(() => ({
  resetKeys: vi.fn(async () => {}),
  KeyUnavailableError: class KeyUnavailableError extends Error {},
}));
vi.mock("../../../src/platform/platformModule.js", () => ({
  KeyLostError: class extends Error {},
  KeyUnavailableError,
  keyPresence: async () => "existing",
  keyState: async () => "existing",
  getDatabaseKeyHex: () => readKey(),
  resetKeys,
}));
let checkFile: (contents: string) => Promise<"intact" | "damaged">;
const checked: string[] = [];
const checkedKeys: string[] = [];
vi.mock("../../../src/platform/expoSqliteDriver.js", () => ({
  checkFileIntegrity: async ({ name, keyHex }: { name: string; keyHex: string }) => {
    const contents = disk.get(name) ?? "";
    checked.push(contents);
    checkedKeys.push(keyHex);
    return checkFile(contents);
  },
  createExpoSqliteDriver: async ({ name }: { name: string }) => {
    const contents = disk.get(name) ?? "";
    opened.push(contents);
    return Object.assign(await openFile(contents), { contents });
  },
}));
let migrateFile: (contents: string) => Promise<number>;
vi.mock("../../../src/db/schema.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/db/schema.js")>()),
  migrate: (db: SqlDriver & { contents: string }) => migrateFile(db.contents),
}));

const driver = (): SqlDriver => ({
  exec: vi.fn(),
  exportTo: vi.fn(),
  run: vi.fn(),
  all: vi.fn(),
  transaction: vi.fn(),
  close: vi.fn(async () => {}),
});
// Built from the module graph the code under test loaded, so its `instanceof` holds.
let NotADb: typeof NotADatabaseError;
let NewerSchemaError: typeof import("../../../src/db/schema.js").NewerSchemaError;
const wrongKey = () => new NotADb("file is not a database");

async function createDatabase() {
  // The module keeps the open and the first-open flag per process; each test starts from freshly
  // imported modules, as a new process would.
  vi.resetModules();
  ({ NotADatabaseError: NotADb } = await import("../../../src/db/driver.js"));
  ({ NewerSchemaError } = await import("../../../src/db/schema.js"));
  return (await import("../../../src/platform/database.js")).createDatabase();
}

// A later open in the same process after a failed one: unlike createDatabase it keeps the module state.
async function openAgain() {
  return (await import("../../../src/platform/database.js")).createDatabase();
}

beforeEach(() => {
  readKey = async () => checkedKeyHex("ab".repeat(32));
  migrateFile = async () => 1;
  checkFile = async () => "intact";
  disk.clear();
  opened.length = 0;
  checked.length = 0;
  checkedKeys.length = 0;
});

describe("createDatabase with a key that does not open the file", () => {
  it("reports key-lost rather than a failed open", async () => {
    disk.set(LIVE_DB, "live");
    openFile = async () => {
      throw wrongKey();
    };
    await expect(createDatabase()).resolves.toEqual({ kind: "keyLost" });
    expect(disk.get(LIVE_DB)).toBe("live");
  });

  it("puts a replaced copy back and opens it when the live file will not open with the key", async () => {
    disk.set(LIVE_DB, "restored");
    disk.set(REPLACED_DB, "old");
    openFile = async (contents) => {
      if (contents === "restored") throw wrongKey();
      return driver();
    };
    expect((await createDatabase()).kind).toBe("ready");
    expect(opened).toEqual(["restored", "old"]);
    expect(disk.get(LIVE_DB)).toBe("old");
    expect(checked).toEqual([]);
  });

  it("reports key-lost when the put-back copy does not open either", async () => {
    disk.set(LIVE_DB, "restored");
    disk.set(REPLACED_DB, "old");
    openFile = async () => {
      throw wrongKey();
    };
    await expect(createDatabase()).resolves.toEqual({ kind: "keyLost" });
    expect(opened).toEqual(["restored", "old"]);
  });

  it("passes any other failure on", async () => {
    disk.set(LIVE_DB, "live");
    openFile = async () => {
      throw new Error("disk full");
    };
    await expect(createDatabase()).rejects.toThrow("disk full");
  });

  it("rejects, never reporting key-lost, when the native side cannot reach the key", async () => {
    disk.set(LIVE_DB, "live");
    resetKeys.mockClear();
    const unavailable = new KeyUnavailableError();
    readKey = async () => {
      throw unavailable;
    };
    openFile = async () => driver();
    await expect(createDatabase()).rejects.toBe(unavailable);
    expect(disk.get(LIVE_DB)).toBe("live");
    expect(resetKeys).not.toHaveBeenCalled();
  });
});

describe("createDatabase after a restore that stopped before the replaced copy was dropped", () => {
  beforeEach(() => {
    disk.set(LIVE_DB, "restored");
    disk.set(REPLACED_DB, "old");
    openFile = async () => driver();
  });

  it("keeps both files when the key is out of reach, and opens the restored one next time", async () => {
    const unavailable = new KeyUnavailableError();
    readKey = async () => {
      throw unavailable;
    };
    await expect(createDatabase()).rejects.toBe(unavailable);
    expect(disk.get(LIVE_DB)).toBe("restored");
    expect(disk.get(REPLACED_DB)).toBe("old");

    readKey = async () => checkedKeyHex("ab".repeat(32));
    expect((await openAgain()).kind).toBe("ready");
    expect(opened).toEqual(["restored"]);
    expect(disk.get(LIVE_DB)).toBe("restored");
    expect(disk.has(REPLACED_DB)).toBe(false);
  });

  it("keeps both files when the open fails with a disk error", async () => {
    openFile = async () => {
      throw new Error("disk I/O error");
    };
    await expect(createDatabase()).rejects.toThrow("disk I/O error");
    expect(disk.get(LIVE_DB)).toBe("restored");
    expect(disk.get(REPLACED_DB)).toBe("old");
  });

  it.each([
    "Error code 13: database or disk is full",
    "unable to open database file",
    "out of memory",
    "attempt to write a readonly database",
    "SQLITE_PROTOCOL",
    "database is locked",
    "an activity vanished while its GPX was deflated",
    "Cannot read properties of undefined",
  ])(
    "keeps both files when the migration fails for a reason that is no proof (%s)",
    async (message) => {
      migrateFile = async () => {
        throw new Error(message);
      };
      await expect(createDatabase()).rejects.toThrow(message);
      expect(disk.get(LIVE_DB)).toBe("restored");
      expect(disk.get(REPLACED_DB)).toBe("old");
    },
  );

  it("puts the replaced copy back when the restored file is from a newer app, without running the check", async () => {
    migrateFile = async (contents) => {
      if (contents === "restored") throw new NewerSchemaError(9);
      return 1;
    };
    expect((await createDatabase()).kind).toBe("ready");
    expect(opened).toEqual(["restored", "old"]);
    expect(disk.get(LIVE_DB)).toBe("old");
    expect(disk.has(REPLACED_DB)).toBe(false);
    expect(checked).toEqual([]);
  });

  it.each([
    ["the migration", "migration"],
    ["the driver's open", "open"],
  ])(
    "puts the replaced copy back when the check finds the file damaged, whatever the error from %s says",
    async (_, where) => {
      checkFile = async (contents) => (contents === "restored" ? "damaged" : "intact");
      const fail = new Error("Error code 1: SQL logic error");
      if (where === "migration") {
        migrateFile = async (contents) => {
          if (contents === "restored") throw fail;
          return 1;
        };
      } else {
        openFile = async (contents) => {
          if (contents === "restored") throw fail;
          return driver();
        };
      }
      expect((await createDatabase()).kind).toBe("ready");
      expect(checked).toEqual(["restored"]);
      expect(opened).toEqual(["restored", "old"]);
      expect(disk.get(LIVE_DB)).toBe("old");
      expect(disk.has(REPLACED_DB)).toBe(false);
    },
  );

  it.each([
    "database disk image is malformed",
    "SQLITE_CORRUPT: database corrupt",
    "Error code 11: database disk image is malformed",
    "Error code 1: SQL logic error",
  ])(
    "keeps both files when the error reads as corrupt (%s) but the check finds the file intact",
    async (message) => {
      migrateFile = async (contents) => {
        if (contents === "restored") throw new Error(message);
        return 1;
      };
      await expect(createDatabase()).rejects.toThrow(message);
      expect(checked).toEqual(["restored"]);
      expect(disk.get(LIVE_DB)).toBe("restored");
      expect(disk.get(REPLACED_DB)).toBe("old");
    },
  );

  it("keeps both files, logging the check's error class, when the check cannot run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      checkFile = async () => {
        throw new RangeError("Error code 11: database disk image is malformed at /data/x");
      };
      migrateFile = async () => {
        throw new Error("database disk image is malformed");
      };
      await expect(createDatabase()).rejects.toThrow("malformed");
      expect(disk.get(LIVE_DB)).toBe("restored");
      expect(disk.get(REPLACED_DB)).toBe("old");
      expect(warn).toHaveBeenCalledWith("crossfog: restore integrity-check", "RangeError");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("/data/x");
    } finally {
      warn.mockRestore();
    }
  });

  it("runs the check with the device key", async () => {
    checkFile = async () => "damaged";
    migrateFile = async (contents) => {
      if (contents === "restored") throw new Error("anything");
      return 1;
    };
    readKey = async () => checkedKeyHex("12".repeat(32));
    await createDatabase();
    expect(checkedKeys).toEqual(["12".repeat(32)]);
  });

  it("keeps both files when the check finds no verdict because the key does not open the file", async () => {
    checkFile = async () => {
      throw new NotADb("page 1 does not verify with this key");
    };
    migrateFile = async () => {
      throw new Error("Error code 1: SQL logic error");
    };
    await expect(createDatabase()).rejects.toThrow("SQL logic error");
    expect(disk.get(LIVE_DB)).toBe("restored");
    expect(disk.get(REPLACED_DB)).toBe("old");
  });

  it("keeps both files when the key cannot be read again for the check", async () => {
    migrateFile = async () => {
      throw new Error("database disk image is malformed");
    };
    let reads = 0;
    readKey = async () => {
      // The open reads the key first; the check asks again after the failure.
      if (++reads > 1) throw new KeyUnavailableError();
      return checkedKeyHex("ab".repeat(32));
    };
    await expect(createDatabase()).rejects.toThrow("malformed");
    expect(checked).toEqual([]);
    expect(disk.get(REPLACED_DB)).toBe("old");
  });

  it("logs only the error class when it puts the replaced copy back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      checkFile = async () => "damaged";
      migrateFile = async (contents) => {
        if (contents === "restored") throw new Error("database disk image is malformed at /data/x");
        return 1;
      };
      await createDatabase();
      expect(warn).toHaveBeenCalledWith("crossfog: restore put-back", "Error");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("/data/x");
    } finally {
      warn.mockRestore();
    }
  });
});
