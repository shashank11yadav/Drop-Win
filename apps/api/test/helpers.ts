import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Ledger } from '../src/ledger.ts';
import { openNodeSqlite, type NodeSqlite } from '../src/node-sqlite.ts';
import { MemoryRateLimiter, type RateLimiter } from '../src/rate-limit.ts';

export const TEST_SECRET = 'test-secret-that-is-long-enough-0123456789';
export const ALLOWED_ORIGIN = 'https://play.example.com';

export function makeLedger(): { db: NodeSqlite; ledger: Ledger } {
  const db = openNodeSqlite(':memory:');
  return { db, ledger: new Ledger(db) };
}

export function makeApp(
  options: { env?: Record<string, string>; limiter?: RateLimiter; ip?: string } = {},
) {
  const { db, ledger } = makeLedger();
  const { config } = loadConfig({
    APP_ENV: 'test',
    SESSION_SECRET: TEST_SECRET,
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ...options.env,
  });
  const app = createApp({
    config,
    players: ledger,
    limiter: options.limiter ?? new MemoryRateLimiter(),
    clientIp: () => options.ip ?? '203.0.113.7',
    logError: () => undefined,
  });
  return { app, db, ledger, config };
}

/** A tiny cookie jar so tests read like a browser session. */
export class Client {
  cookie = '';
  readonly app: ReturnType<typeof makeApp>['app'];

  constructor(app: ReturnType<typeof makeApp>['app']) {
    this.app = app;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('Cookie', this.cookie);
    const response = await this.app.request(`http://localhost${path}`, { ...init, headers });
    const setCookie = response.headers.get('Set-Cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? '';
    return response;
  }

  post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  bet(body: unknown, key: string = crypto.randomUUID()): Promise<Response> {
    return this.post('/api/bets', body, { 'Idempotency-Key': key });
  }
}
