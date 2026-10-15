import { BrowserBackend } from './browser.ts';

/** Starts the house in a Web Worker and returns the backend that talks to it. */
export function startBrowserHouse(): BrowserBackend {
  const worker = new Worker(new URL('../house/worker.ts', import.meta.url), {
    type: 'module',
    name: 'drop-win-house',
  });
  const backend = new BrowserBackend(worker);
  worker.addEventListener('error', () => {
    backend.fail();
  });
  return backend;
}
