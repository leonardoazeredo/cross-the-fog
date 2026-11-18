export interface FogCache {
  get(fingerprint: string): Promise<Uint8Array | null>;
  /** Clears the store and writes `bytes` under `fingerprint` as the sole entry. */
  putOnly(fingerprint: string, bytes: Uint8Array): Promise<void>;
  clearAll(): Promise<void>;
  /** The cells an activity's track revealed, with the rules and the activity fingerprint it was made under. */
  getReveal(activityId: string): Promise<CachedReveal | null>;
  putReveal(activityId: string, stamp: RevealStamp, cells: Int32Array): Promise<void>;
  deleteReveal(activityId: string): Promise<void>;
  revealIds(): Promise<string[]>;
}

/** What a cached reveal was made from; any difference from the current values means recompute. */
export interface RevealStamp {
  rulesVersion: number;
  /** Hash of the whole rules object, so a tuned number without a version bump is still noticed. */
  rulesHash: string;
  /** The activity's `endedAt` and distance: a track replaced under the same id usually differs in one of them (a cheap proxy, not a hash of the points). */
  endedAt: string;
  distanceM: number;
}

interface CachedReveal extends RevealStamp {
  /** `[cx, cy]` pairs as Int32 values. */
  cells: ArrayBuffer;
}

const DB_NAME = "crossfog";
const STORE = "copies";
const REVEALS = "reveals";

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 3);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Reveals without a fingerprint cannot be checked; they are rebuilt from the tracks.
      if (event.oldVersion > 0 && event.oldVersion < 3 && db.objectStoreNames.contains(REVEALS)) {
        db.deleteObjectStore(REVEALS);
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(REVEALS)) {
        db.createObjectStore(REVEALS);
      }
    };
    let blocked = false;
    req.onsuccess = () => {
      // The holder closed after we gave up: nobody will use this connection, and it would block the next upgrade.
      if (blocked) req.result.close();
      else resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    // Another connection to the old version stays open: the upgrade would wait for it, and `ready` with it,
    // so the page runs without the cache instead.
    req.onblocked = () => {
      blocked = true;
      reject(new Error("blocked"));
    };
  });
}

// Every call resolves to `fallback` on a throw, an error or an abort (a full disk aborts at commit and
// fires onabort, not onerror), so a broken store never stalls the history sync that awaits it.
// The failure is logged once, by error name only: a message can carry the key or a file name.
function run<T>(
  fallback: T,
  body: (done: (value: T) => void, fail: (err?: unknown) => void) => void,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const fail = (err?: unknown) => {
      if (settled) return;
      settled = true;
      const name = (err as { name?: unknown } | null)?.name;
      console.warn(`crossfog: fog cache failed (${typeof name === "string" ? name : "unknown"})`);
      resolve(fallback);
    };
    try {
      body((value) => {
        settled = true;
        resolve(value);
      }, fail);
    } catch (err) {
      fail(err);
    }
  });
}

// A request's error bubbles to the transaction's onerror first, while tx.error is still null (it is set
// only when the transaction then aborts), so the name comes from the event's own request.
function requestError(e: Event | undefined): unknown {
  return (e?.target as { error?: unknown } | null | undefined)?.error;
}

// A throw inside a request's callback never reaches run()'s try/catch, so the callback reports it itself.
function guarded(fail: (err?: unknown) => void, fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (err) {
      fail(err);
    }
  };
}

const noop: FogCache = {
  get: () => Promise.resolve(null),
  putOnly: () => Promise.resolve(),
  clearAll: () => Promise.resolve(),
  getReveal: () => Promise.resolve(null),
  putReveal: () => Promise.resolve(),
  deleteReveal: () => Promise.resolve(),
  revealIds: () => Promise.resolve([]),
};

export async function openFogCache(
  idb: IDBFactory | undefined,
  enabled: boolean,
): Promise<FogCache> {
  if (!enabled || idb == null) return noop;

  let db: IDBDatabase;
  try {
    db = await openDb(idb);
  } catch {
    return noop;
  }

  return {
    get(fingerprint) {
      return run<Uint8Array | null>(null, (done, fail) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(fingerprint);
        req.onsuccess = guarded(fail, () => {
          const raw = req.result as Uint8Array | undefined;
          if (raw == null) {
            done(null);
            return;
          }
          // Normalize to a detached, plain Uint8Array: fake-indexeddb returns Node.js Buffer
          // values, which fail strict equality checks (e.g. toEqual in tests) because Buffer
          // and Uint8Array have different constructors despite Buffer being a subclass.
          // A plain copy also avoids returning a view over an engine-internal backing store.
          const copy = new Uint8Array(raw.length);
          copy.set(raw);
          done(copy);
        });
        req.onerror = () => fail(req.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    putOnly(fingerprint, bytes) {
      return run<void>(undefined, (done, fail) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const clearReq = store.clear();
        clearReq.onsuccess = () => {
          store.put(bytes, fingerprint);
        };
        tx.oncomplete = () => done();
        tx.onerror = (e) => fail(requestError(e) ?? tx.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    clearAll() {
      return run<void>(undefined, (done, fail) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => done();
        tx.onerror = (e) => fail(requestError(e) ?? tx.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    getReveal(activityId) {
      return run<CachedReveal | null>(null, (done, fail) => {
        const tx = db.transaction(REVEALS, "readonly");
        const req = tx.objectStore(REVEALS).get(activityId);
        req.onsuccess = guarded(fail, () => {
          const raw = req.result as Partial<CachedReveal> | undefined;
          const { rulesVersion, rulesHash, endedAt, distanceM, cells } = raw ?? {};
          const whole =
            typeof rulesVersion === "number" &&
            typeof rulesHash === "string" &&
            typeof endedAt === "string" &&
            typeof distanceM === "number" &&
            Object.prototype.toString.call(cells) === "[object ArrayBuffer]";
          done(
            whole
              ? { rulesVersion, rulesHash, endedAt, distanceM, cells: cells as ArrayBuffer }
              : null,
          );
        });
        req.onerror = () => fail(req.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    putReveal(activityId, stamp, cells) {
      return run<void>(undefined, (done, fail) => {
        const tx = db.transaction(REVEALS, "readwrite");
        // slice() copies just this view's bytes; `cells.buffer` could be a larger buffer shared with
        // other data, and the caller may reuse the array.
        tx.objectStore(REVEALS).put({ ...stamp, cells: cells.slice().buffer }, activityId);
        tx.oncomplete = () => done();
        tx.onerror = (e) => fail(requestError(e) ?? tx.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    deleteReveal(activityId) {
      return run<void>(undefined, (done, fail) => {
        const tx = db.transaction(REVEALS, "readwrite");
        tx.objectStore(REVEALS).delete(activityId);
        tx.oncomplete = () => done();
        tx.onerror = (e) => fail(requestError(e) ?? tx.error);
        tx.onabort = () => fail(tx.error);
      });
    },

    revealIds() {
      return run<string[]>([], (done, fail) => {
        const tx = db.transaction(REVEALS, "readonly");
        const req = tx.objectStore(REVEALS).getAllKeys();
        req.onsuccess = guarded(fail, () => done((req.result as IDBValidKey[]).map(String)));
        req.onerror = () => fail(req.error);
        tx.onabort = () => fail(tx.error);
      });
    },
  };
}
