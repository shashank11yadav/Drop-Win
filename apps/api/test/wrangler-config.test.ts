import { readFileSync } from 'node:fs';
import { RATE_LIMITS } from '@drop-win/contract';
import { describe, expect, it } from 'vitest';

interface RateLimitBinding {
  name: string;
  simple: { limit: number; period: number };
}

function readWranglerConfig(): { ratelimits: RateLimitBinding[]; vars: Record<string, string> } {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // Strip // comments; the file has no block comments or "//" inside strings.
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as ReturnType<typeof readWranglerConfig>;
}

describe('wrangler.jsonc', () => {
  it('uses the same rate limits as the Node server', () => {
    const { ratelimits } = readWranglerConfig();
    const byName = Object.fromEntries(ratelimits.map((r) => [r.name, r.simple]));
    expect(byName['API_RATE_LIMIT']).toEqual({
      limit: RATE_LIMITS.api.limit,
      period: RATE_LIMITS.api.periodSeconds,
    });
    expect(byName['SESSION_RATE_LIMIT']).toEqual({
      limit: RATE_LIMITS.session.limit,
      period: RATE_LIMITS.session.periodSeconds,
    });
    expect(byName['BET_RATE_LIMIT']).toEqual({
      limit: RATE_LIMITS.bet.limit,
      period: RATE_LIMITS.bet.periodSeconds,
    });
  });

  it('runs in production mode and keeps the session secret out of vars', () => {
    const { vars } = readWranglerConfig();
    expect(vars['APP_ENV']).toBe('production');
    expect(vars).not.toHaveProperty('SESSION_SECRET');
  });
});
