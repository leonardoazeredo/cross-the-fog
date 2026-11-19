import {
  type AttachedBackup,
  NotADatabaseError,
  type OpenBackup,
  type SqlDriver,
  type SqlTx,
  type SqlValue,
} from "../db/driver.js";
import type { DatabaseKeyHex } from "../db/keyHex.js";

/** The slice of expo-sqlite's `SQLiteDatabase` the driver uses; a transaction connection has the same one. */
export interface ExpoDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
  withExclusiveTransactionAsync(task: (txn: ExpoDb) => Promise<void>): Promise<void>;
}

export interface ExpoSqliteDriverOptions {
  name: string;
  keyHex: DatabaseKeyHex;
  open?: (name: string) => Promise<ExpoDb>;
}

// What SQLCipher's cipher_integrity_check says of a page it read and found bad.
const PAGE_REPORT = /^(HMAC verification failed for page \d+|page \d+ has an invalid size of .*)$/;

async function openNewConnection(name: string): Promise<ExpoDb> {
  const { openDatabaseAsync } = await import("expo-sqlite");
  return (await openDatabaseAsync(name, { useNewConnection: true })) as unknown as ExpoDb;
}

async function defaultOpen(name: string): Promise<ExpoDb> {
  const { openDatabaseAsync } = await import("expo-sqlite");
  return (await openDatabaseAsync(name)) as unknown as ExpoDb;
}

// The path and the key are bound, never spliced into the statement: a passphrase may hold any
// character, and SQLite's error text for a bad statement can echo what was spliced in.
async function copyOut(db: ExpoDb, from: string, to: string, path: string, key: string | null) {
  await db.runAsync(`ATTACH DATABASE ? AS ${to} KEY ?`, [path, key ?? ""]);
  try {
    // sqlcipher_export copies the tables but the user version is set by hand, so a restore can tell the schema.
    const [row] = await db.getAllAsync<{ user_version: number }>(`PRAGMA ${from}.user_version`, []);
    await db.getAllAsync(`SELECT sqlcipher_export('${to}', '${from}')`, []);
    await db.execAsync(`PRAGMA ${to}.user_version = ${Number(row?.user_version ?? 0)}`);
  } finally {
    await db.execAsync(`DETACH DATABASE ${to}`);
  }
}

/** Opens a backup on a throwaway in-memory connection with the file attached as `backup`. */
export function createOpenBackup(
  openMemory: () => Promise<ExpoDb> = async () => {
    const { openDatabaseAsync } = await import("expo-sqlite");
    // A new connection each time: ":memory:" is otherwise cached and two backups would share one.
    return (await openDatabaseAsync(":memory:", {
      useNewConnection: true,
    })) as unknown as ExpoDb;
  },
): OpenBackup {
  return async (path, key) => {
    const db = await openMemory();
    try {
      await db.runAsync("ATTACH DATABASE ? AS backup KEY ?", [path, key ?? ""]);
      // The first read fails with "file is not a database" when the key is wrong or the file is no database.
      await db.getAllAsync("SELECT count(*) FROM backup.sqlite_master", []);
    } catch (e) {
      await db.closeAsync().catch(() => undefined);
      if (e instanceof Error && /not a database/i.test(e.message)) {
        throw new NotADatabaseError("file is not a database", { cause: e });
      }
      throw e;
    }
    const attached: AttachedBackup = {
      ...wrap(db),
      exportTo: (target, targetKey) => copyOut(db, "backup", "out", target, targetKey),
      close: () => db.closeAsync(),
    };
    return attached;
  };
}

function wrap(db: ExpoDb): SqlTx {
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params = []) {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: (sql, params = []) => db.getAllAsync(sql, params),
  };
}

/**
 * What the database's own checks say about a file: "damaged" when SQLCipher reports a page that
 * fails its HMAC or has the wrong size (`cipher_integrity_check` returns one row per such page) or
 * SQLite's `integrity_check` answers anything but its single row "ok". It writes nothing and opens
 * a new connection (the driver's open reads sqlite_master and sets WAL, which touch the file under
 * test, and a cached connection of the failed open would already be keyed).
 *
 * A check that cannot run is no verdict and rejects, so the caller never takes it for one:
 * - `NotADatabaseError` when page 1 fails its HMAC, which is what a wrong key looks like, because
 *   under a wrong key `cipher_integrity_check` lists every page of a good file;
 * - an error when `cipher_integrity_check` answers with a row that reports neither of those two
 *   failures (it reports a failed read, a failed key derivation or an out of memory as a row, and
 *   none of those says anything about the file);
 * - whatever `integrity_check` throws when it cannot read the file (it throws, not reports, on a
 *   file cut at a page boundary).
 */
export async function checkFileIntegrity(opts: {
  name: string;
  keyHex: DatabaseKeyHex;
  open?: (name: string) => Promise<ExpoDb>;
}): Promise<"intact" | "damaged"> {
  if (!/^[0-9a-f]{64}$/.test(opts.keyHex)) throw new Error("database key must be 64 hex digits");
  const db = await (opts.open ?? openNewConnection)(opts.name);
  try {
    await db.execAsync(`PRAGMA key = "x'${opts.keyHex}'"`);
    const pages = await db.getAllAsync<Record<string, unknown>>(
      "PRAGMA cipher_integrity_check",
      [],
    );
    const reports = pages.map((row) => String(Object.values(row)[0]));
    if (reports.some((r) => r === "HMAC verification failed for page 1")) {
      throw new NotADatabaseError("page 1 does not verify with this key");
    }
    if (reports.some((r) => !PAGE_REPORT.test(r))) {
      throw new Error("cipher_integrity_check answered with something that is not a page report");
    }
    if (reports.length > 0) return "damaged";
    const rows = await db.getAllAsync<Record<string, unknown>>("PRAGMA integrity_check", []);
    const only = rows.length === 1 ? Object.values(rows[0] ?? {}) : [];
    return only.length === 1 && only[0] === "ok" ? "intact" : "damaged";
  } finally {
    await db.closeAsync().catch((closeError: unknown) => {
      console.warn(
        "crossfog: database close failed",
        closeError instanceof Error ? closeError.name : "unknown",
      );
    });
  }
}

export async function createExpoSqliteDriver(opts: ExpoSqliteDriverOptions): Promise<SqlDriver> {
  // The key goes into a PRAGMA, which cannot take a bound parameter; only 32 bytes of hex may reach it.
  if (!/^[0-9a-f]{64}$/.test(opts.keyHex)) throw new Error("database key must be 64 hex digits");
  const keyPragma = `PRAGMA key = "x'${opts.keyHex}'"`;

  const db = await (opts.open ?? defaultOpen)(opts.name);
  try {
    await db.execAsync(keyPragma);
    // Without SQLCipher in the build PRAGMA key is a silent no-op and the history would be plaintext.
    const cipher = await db.getAllAsync<unknown>("PRAGMA cipher_version", []);
    if (cipher.length === 0) throw new Error("expo-sqlite was built without SQLCipher");
    // The first read fails with "file is not a database" when the key is wrong.
    await db.getAllAsync("SELECT count(*) FROM sqlite_master", []);
    await db.execAsync("PRAGMA journal_mode = WAL");
  } catch (e) {
    await db.closeAsync().catch((closeError: unknown) => {
      console.warn(
        "crossfog: database close failed",
        closeError instanceof Error ? closeError.name : "unknown",
      );
    });
    if (e instanceof Error && /not a database/i.test(e.message)) {
      throw new NotADatabaseError("file is not a database", { cause: e });
    }
    throw e;
  }

  let tail: Promise<unknown> = Promise.resolve();
  // Queries, transactions, exports and close wait in this one line: a plain query on the main connection
  // fails with "database is locked" while a transaction is open on its own connection. The
  // callback's own queries use `wrap(txn)` and skip the line; a call on this driver from inside a
  // callback would wait forever on the transaction it is part of, and nothing detects or prevents that.
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  };
  const plain = wrap(db);
  return {
    exec: (sql) => enqueue(() => plain.exec(sql)),
    run: (sql, params) => enqueue(() => plain.run(sql, params)),
    all: <T>(sql: string, params?: SqlValue[]) => enqueue(() => plain.all<T>(sql, params)),
    transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        let result: { value: T } | undefined;
        await db.withExclusiveTransactionAsync(async (txn) => {
          // The exclusive transaction opens its own connection, which starts unkeyed, so key it before the callback runs.
          await txn.execAsync(keyPragma);
          result = { value: await fn(wrap(txn)) };
        });
        if (!result) throw new Error("transaction did not run");
        return result.value;
      };
      return enqueue(run);
    },
    exportTo: (path, key) => enqueue(() => copyOut(db, "main", "backup", path, key)),
    close: () => enqueue(() => db.closeAsync()),
  };
}
