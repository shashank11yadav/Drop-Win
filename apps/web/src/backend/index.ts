import { createHttpBackend } from './http.ts';
import type { GameBackend } from './types.ts';

export { GameError, placeBet, type GameBackend } from './types.ts';

export const backend: GameBackend = createHttpBackend({
  base: import.meta.env.VITE_API_BASE ?? '',
});
