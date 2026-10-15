// Web Worker entry for browser mode. Vite bundles this file separately and the
// page loads it from its own origin, so the CSP's 'self' covers it.

import { House, serveHouse } from './house.ts';
import { indexedDbStorage } from './idb.ts';
import type { PortLike } from './protocol.ts';

// The app is type-checked against the DOM library, where `self` is a Window.
// In a dedicated worker it is the worker scope, which has the same two methods.
const scope = self as unknown as PortLike;

const LOCK_WAIT_MS = 1500;
const SECOND_TAB =
  'Drop-Win is already open in another tab, so this tab plays without saving. Close the other tab and reload to keep your progress.';

/**
 * Two tabs would each hold their own copy of the ledger and overwrite each
 * other's saves, so only the tab holding this lock touches IndexedDB. It waits
 * a moment rather than giving up at once, because on a reload the old page's
 * worker may not have released it yet.
 */
function ownsStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return Promise.resolve(true);
  const signal = AbortSignal.timeout(LOCK_WAIT_MS);
  return new Promise((resolve) => {
    navigator.locks
      .request('drop-win-house', { signal }, () => {
        resolve(true);
        // Held until the worker goes away with its tab.
        return new Promise<never>(() => undefined);
      })
      .catch(() => {
        // Timed out: another tab has it. Any other failure: locks are not
        // usable here, so fall back to saving as if this were the only tab.
        resolve(!signal.aborted);
      });
  });
}

serveHouse(
  scope,
  ownsStorage().then((owner) => {
    if (!owner) scope.postMessage({ notice: SECOND_TAB });
    return new House({ storage: owner ? indexedDbStorage() : null });
  }),
);
