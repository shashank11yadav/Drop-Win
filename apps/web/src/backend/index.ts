import { createHttpBackend } from './http.ts';
import type { GameBackend } from './types.ts';

export { GameError, placeBet, type GameBackend } from './types.ts';

/**
 * Chosen at build time: VITE_BACKEND=browser for the static demo, otherwise
 * the API. The import is dynamic so a server build does not ship the worker.
 */
export const backend: GameBackend =
  import.meta.env.VITE_BACKEND === 'browser'
    ? (await import('./house-worker.ts')).startBrowserHouse()
    : createHttpBackend({ base: import.meta.env.VITE_API_BASE ?? '' });
