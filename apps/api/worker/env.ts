import type { PlayerVault } from './player-vault.ts';

export interface WorkerEnv {
  PLAYERS: DurableObjectNamespace<PlayerVault>;
  API_RATE_LIMIT: RateLimit;
  SESSION_RATE_LIMIT: RateLimit;
  BET_RATE_LIMIT: RateLimit;
  APP_ENV?: string;
  SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  COOKIE_SAMESITE?: string;
}
