// Cloudflare Worker entry. Static assets (the web app) are served by the
// platform; only /api/* reaches this code (see run_worker_first in wrangler.jsonc).

import type { RateLimitName } from '@drop-win/contract';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { PlayerStore } from '../src/ledger.ts';
import type { RateLimiter } from '../src/rate-limit.ts';
import type { WorkerEnv } from './env.ts';

export { PlayerVault } from './player-vault.ts';

function playerStore(env: WorkerEnv): PlayerStore {
  const vault = (playerId: string) => env.PLAYERS.get(env.PLAYERS.idFromName(playerId));
  return {
    create: (playerId) => vault(playerId).create(playerId),
    state: (playerId) => vault(playerId).state(playerId),
    bet: (playerId, request, key) => vault(playerId).bet(playerId, request, key),
    rotateSeed: (playerId, clientSeed) => vault(playerId).rotateSeed(playerId, clientSeed),
    history: (playerId, before) => vault(playerId).history(playerId, before),
    refill: (playerId) => vault(playerId).refill(playerId),
  };
}

function rateLimiter(env: WorkerEnv): RateLimiter {
  const bindings: Record<RateLimitName, RateLimit> = {
    api: env.API_RATE_LIMIT,
    session: env.SESSION_RATE_LIMIT,
    bet: env.BET_RATE_LIMIT,
  };
  return {
    limit: async (name, key) => (await bindings[name].limit({ key })).success,
  };
}

// Built once per isolate; env does not change between requests.
const apps = new WeakMap<WorkerEnv, ReturnType<typeof createApp>>();

function appFor(env: WorkerEnv): ReturnType<typeof createApp> {
  let app = apps.get(env);
  if (!app) {
    const { config } = loadConfig({ ...env });
    app = createApp({
      config,
      players: playerStore(env),
      limiter: rateLimiter(env),
      clientIp: (c) => c.req.header('CF-Connecting-IP') ?? 'unknown',
      logError: (error) => {
        console.error(error);
      },
    });
    apps.set(env, app);
  }
  return app;
}

export default {
  fetch(request, env, ctx) {
    return appFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv>;
