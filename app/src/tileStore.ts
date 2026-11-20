// A small key-value store with least-recently-used eviction, for caches that must never break the
// page: IndexedDB when the WebView has it, a plain in-memory Map when it does not or it fails to
// open. Values are structured-clone friendly; nothing is encrypted at rest. `backend` says which
// one the caller got ("indexeddb" or "memory").
// strictly increasing, so two operations in the same millisecond still order; Date.now keeps the
// order across sessions for the persisted store
let last = 0;
const stamp = () => {
  last = Math.max(Date.now(), last + 1);
  return last;
};

// IndexedDB only: a read rewrites an entry's usedAt only when that usedAt is more than this old: answers are large, and a plan over many cached
// tiles would otherwise write every one of them back
const TOUCH_MS = 3600 * 1000;
// a WebView whose IndexedDB never answers must not hang whatever waits on it
const TIMEOUT_MS = 10000;

export interface StoreOptions {
  maxEntries?: number;
  timeoutMs?: number;
}

// What `open` reads from the page, handed in by pageGlobals.ts when it is called: the page's IndexedDB factory
// (absent in a WebView without one).
export interface StoreHost {
  indexedDB?: IDBFactory | null;
}

// The store every caller holds: values are structured-clone friendly.
export interface TileStoreApi<V = unknown> {
  backend: "indexeddb" | "memory";
  get(key: string): Promise<V | undefined>;
  put(key: string, value: V): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  keys(): Promise<string[]>;
}

const capOf = (opts?: StoreOptions): number => opts?.maxEntries || Infinity;

export function memory(opts?: StoreOptions): TileStoreApi {
  const maxEntries = capOf(opts);
  const m = new Map<string, { value: unknown; usedAt: number }>(); // key -> {value, usedAt}
  // copies in and out, like IndexedDB: a caller that mutates an answer must not corrupt the store, as it could not with IndexedDB
  return {
    backend: "memory",
    async get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      e.usedAt = stamp();
      return structuredClone(e.value);
    },
    async put(key, value) {
      m.set(key, { value: structuredClone(value), usedAt: stamp() });
      while (m.size > maxEntries) {
        let oldest: { key: string; usedAt: number } | null = null;
        for (const [k, e] of m)
          if (oldest === null || e.usedAt < oldest.usedAt) oldest = { key: k, usedAt: e.usedAt };
        m.delete((oldest as unknown as { key: string }).key);
      }
    },
    async delete(key) {
      m.delete(key);
    },
    async keys() {
      return [...m.keys()];
    },
  };
}

// `work(objectStore)` starts the requests and returns the one whose result the call resolves with (or nothing)
type Work = (os: IDBObjectStore) => IDBRequest | undefined | void;

const nameIs = (e: unknown, name: string): boolean => !!e && (e as { name?: string }).name === name;

const timeoutError = (what: string) =>
  Object.assign(new Error(what + " timed out"), { name: "TimeoutError" });

function openDb(
  host: StoreHost,
  dbName: string,
  storeName: string,
  timeoutMs: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    };
    const timer = setTimeout(() => fail(timeoutError("open")), timeoutMs);
    const req = (host.indexedDB as IDBFactory).open(dbName, 1);
    req.onupgradeneeded = () => {
      // the usedAt index orders eviction without reading the values, which can be large
      req.result.createObjectStore(storeName, { keyPath: "key" }).createIndex("usedAt", "usedAt");
    };
    req.onsuccess = () => {
      // a request that succeeds after it was given up on (blocked, timed out) would leak its connection
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error("blocked"));
  });
}

function idbStore(
  first: IDBDatabase,
  reopen: () => Promise<IDBDatabase>,
  storeName: string,
  maxEntries: number,
  timeoutMs: number,
): TileStoreApi {
  let db: IDBDatabase | null = null,
    reopening: Promise<IDBDatabase> | null = null;
  // a connection the browser closes (versionchange) or that stops answering is dropped, and the
  // next call opens a new one
  const adopt = (d: IDBDatabase) => {
    d.onversionchange = () => {
      d.close();
      if (db === d) db = null;
    };
    db = d;
    return d;
  };
  const drop = (d: IDBDatabase) => {
    if (db === d) db = null;
    try {
      d.close();
    } catch (e) {
      /* already closed */
    }
  };
  const connection = async (): Promise<IDBDatabase> => {
    if (db) return db;
    if (!reopening)
      reopening = reopen()
        .then(adopt)
        .finally(() => {
          reopening = null;
        });
    return reopening;
  };
  adopt(first);

  // `work(objectStore)` starts the requests and returns the one whose result the call resolves with
  // (or nothing), once the transaction has committed
  const runTx = (t: IDBTransaction, work: Work) =>
    new Promise<unknown>((resolve, reject) => {
      let req: IDBRequest | undefined | void;
      const timer = setTimeout(() => {
        reject(timeoutError("transaction")); // before the abort, whose own event would otherwise speak first
        try {
          t.abort();
        } catch (e) {
          /* already finished */
        }
      }, timeoutMs);
      t.oncomplete = () => {
        clearTimeout(timer);
        resolve(req ? req.result : undefined);
      };
      t.onerror = (ev) => {
        clearTimeout(timer);
        reject(
          (ev?.target as IDBRequest | null)?.error || t.error || new Error("transaction failed"),
        );
      };
      t.onabort = () => {
        clearTimeout(timer);
        reject(t.error || new Error("transaction aborted"));
      };
      try {
        req = work(t.objectStore(storeName));
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  const tx = async (mode: IDBTransactionMode, work: Work, retried?: boolean): Promise<unknown> => {
    const d = await connection();
    let t: IDBTransaction;
    try {
      t = d.transaction(storeName, mode);
    } catch (e) {
      // closed behind our back
      if (!nameIs(e, "InvalidStateError")) throw e;
      drop(d);
      if (retried) throw e;
      return tx(mode, work, true);
    }
    try {
      return await runTx(t, work);
    } catch (e) {
      if (nameIs(e, "TimeoutError")) drop(d);
      throw e;
    }
  };

  // delete the n entries used longest ago
  const dropOldest = (os: IDBObjectStore, n: number) => {
    const cur = os.index("usedAt").openKeyCursor(); // oldest first
    cur.onsuccess = () => {
      const p = cur.result;
      if (!p || n-- <= 0) return;
      os.delete(p.primaryKey);
      p.continue();
    };
  };
  const putOnce = (key: string, value: unknown) =>
    tx("readwrite", (os) => {
      os.put({ key, value, usedAt: stamp() });
      const c = os.count();
      c.onsuccess = () => {
        if (c.result > maxEntries) dropOldest(os, c.result - maxEntries);
      };
    });
  // best effort: a failed touch only leaves the entry looking older than it is
  const touch = (key: string) =>
    tx("readwrite", (os) => {
      const r = os.get(key);
      r.onsuccess = () => {
        if (r.result) {
          r.result.usedAt = stamp();
          os.put(r.result);
        }
      };
    }).catch(() => {});

  return {
    backend: "indexeddb",
    async get(key) {
      const e = (await tx("readonly", (os) => os.get(key))) as
        | { value: unknown; usedAt: number }
        | undefined;
      if (!e) return undefined;
      if (Date.now() - e.usedAt > TOUCH_MS) touch(key);
      return e.value;
    },
    async put(key, value) {
      try {
        return await putOnce(key, value);
      } catch (e) {
        if (!nameIs(e, "QuotaExceededError")) throw e;
        // a full disk: drop the oldest tenth of maxEntries, rounded up (16 when unbounded) and try once more
        await tx("readwrite", (os) =>
          dropOldest(os, Number.isFinite(maxEntries) ? Math.ceil(maxEntries / 10) : 16),
        );
        return putOnce(key, value);
      }
    },
    delete: (key) =>
      tx("readwrite", (os) => {
        os.delete(key);
      }),
    keys: () => tx("readonly", (os) => os.getAllKeys()).then((k) => (k || []) as string[]),
  };
}

// Never rejects: any failure to reach IndexedDB hands back a memory store, so callers need no
// second path.
export async function open(
  host: StoreHost,
  dbName: string,
  storeName: string,
  opts?: StoreOptions,
): Promise<TileStoreApi> {
  const maxEntries = capOf(opts);
  const timeoutMs = opts?.timeoutMs || TIMEOUT_MS;
  const connect = () => openDb(host, dbName, storeName, timeoutMs);
  try {
    if (!host.indexedDB) throw new Error("no indexedDB");
    return idbStore(await connect(), connect, storeName, maxEntries, timeoutMs);
  } catch (e) {
    console.warn(
      "tile store: IndexedDB unavailable, caching in memory only",
      (e as Error | undefined)?.name,
    );
    return memory(opts);
  }
}

// What the page's `window.TileStore` is made of; pageGlobals.ts gives `open` the page's IndexedDB.
export const TileStore = { open, memory };
