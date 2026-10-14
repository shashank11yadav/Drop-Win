// Node entry point: the same Hono app as the Worker, backed by a SQLite file.
// Optionally serves the built web app so one process runs the whole thing.

import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { webSecurityHeaders } from '@drop-win/contract';
import * as z from 'zod/mini';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { Ledger } from './ledger.ts';
import { openNodeSqlite } from './node-sqlite.ts';
import { MemoryRateLimiter } from './rate-limit.ts';

const NodeEnv = z.object({
  PORT: z._default(z.coerce.number().check(z.int(), z.gte(1), z.lte(65_535)), 5301),
  HOST: z._default(z.string(), '127.0.0.1'),
  DATABASE_PATH: z._default(z.string(), 'data/drop-win.sqlite'),
  TRUST_PROXY: z._default(z.enum(['true', 'false']), 'false'),
  WEB_DIST: z.optional(z.string()),
});

const { config, warnings } = loadConfig(process.env);
const nodeEnv = NodeEnv.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')),
);
for (const warning of warnings) console.warn(`warning: ${warning}`);

if (nodeEnv.DATABASE_PATH !== ':memory:') {
  mkdirSync(dirname(resolve(nodeEnv.DATABASE_PATH)), { recursive: true });
}
const db = openNodeSqlite(nodeEnv.DATABASE_PATH);
const trustProxy = nodeEnv.TRUST_PROXY === 'true';

const app = createApp({
  config,
  players: new Ledger(db),
  limiter: new MemoryRateLimiter(),
  clientIp: (c) => {
    // Only believe X-Forwarded-For behind a proxy that sets it; otherwise any
    // client could pick its own rate-limit key.
    if (trustProxy) {
      const forwarded = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    return getConnInfo(c).remote.address ?? 'unknown';
  },
  logError: (error) => {
    console.error(error);
  },
});

if (nodeEnv.WEB_DIST) {
  const root = relative(process.cwd(), resolve(nodeEnv.WEB_DIST));
  const headers = webSecurityHeaders();
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/')) {
      for (const [name, value] of Object.entries(headers)) c.header(name, value);
    }
  });
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const server = serve({ fetch: app.fetch, port: nodeEnv.PORT, hostname: nodeEnv.HOST }, (info) => {
  console.log(`drop-win api listening on http://${info.address}:${String(info.port)}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
