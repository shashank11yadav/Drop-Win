import type { HouseStorage } from './house.ts';

const DB_NAME = 'drop-win-demo';
const DB_VERSION = 1;
const STORES = ['players', 'seeds', 'bets'] as const;

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

/**
 * The house's ledger in IndexedDB, which (unlike localStorage) is available
 * inside a worker. Each ledger commit becomes one IndexedDB transaction, so a
 * crash leaves the last complete bet saved, never half of one.
 */
export function indexedDbStorage(): HouseStorage | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB open failed'));
      };
      request.onblocked = () => {
        reject(new Error('IndexedDB open blocked'));
      };
    });
    // A failed open is retried next time rather than cached.
    opened.catch(() => {
      opened = null;
    });
    return opened;
  };

  return {
    async load() {
      const db = await open();
      const tx = db.transaction(STORES, 'readonly');
      const [players, seeds, bets] = await Promise.all(
        STORES.map((name) => promised<unknown[]>(tx.objectStore(name).getAll())),
      );
      if (!players?.length && !seeds?.length && !bets?.length) return null;
      return { players, seeds, bets };
    },

    async save(changes) {
      const db = await open();
      const tx = db.transaction(STORES, 'readwrite');
      for (const player of changes.players) tx.objectStore('players').put(player);
      for (const seed of changes.seeds) tx.objectStore('seeds').put(seed);
      for (const bet of changes.bets) tx.objectStore('bets').put(bet);
      await done(tx);
    },

    async clear() {
      const db = await open();
      const tx = db.transaction(STORES, 'readwrite');
      for (const name of STORES) tx.objectStore(name).clear();
      await done(tx);
    },
  };
}
