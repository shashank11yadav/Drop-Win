import { RATE_LIMITS } from '@drop-win/contract';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
import { MemoryRateLimiter } from '../src/rate-limit.ts';

const secret = 'x'.repeat(32);

describe('loadConfig', () => {
  it('requires a session secret in production', () => {
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(
      ConfigError,
    );
  });

  it('generates a throwaway secret in development and says so', () => {
    const { config, warnings } = loadConfig({ SESSION_SECRET: '' });
    expect(config.sessionSecret).toHaveLength(64);
    expect(warnings).toHaveLength(1);
  });

  it('parses and validates allowed origins', () => {
    const { config } = loadConfig({
      SESSION_SECRET: secret,
      ALLOWED_ORIGINS: 'https://a.example, http://localhost:5300',
    });
    expect(config.allowedOrigins).toEqual(['https://a.example', 'http://localhost:5300']);
    expect(() =>
      loadConfig({ SESSION_SECRET: secret, ALLOWED_ORIGINS: 'https://a.example/path' }),
    ).toThrow(ConfigError);
    expect(() => loadConfig({ SESSION_SECRET: secret, ALLOWED_ORIGINS: '*' })).toThrow(ConfigError);
  });

  it('forces Secure cookies in production and with SameSite=None', () => {
    expect(loadConfig({ SESSION_SECRET: secret }).config.cookieSecure).toBe(false);
    expect(loadConfig({ SESSION_SECRET: secret, APP_ENV: 'production' }).config.cookieSecure).toBe(
      true,
    );
    expect(
      loadConfig({ SESSION_SECRET: secret, COOKIE_SAMESITE: 'None' }).config.cookieSecure,
    ).toBe(true);
  });

  it('rejects unknown enum values', () => {
    expect(() => loadConfig({ APP_ENV: 'staging' })).toThrow(ConfigError);
    expect(() => loadConfig({ COOKIE_SAMESITE: 'none' })).toThrow(ConfigError);
  });
});

describe('MemoryRateLimiter', () => {
  it('allows the configured number of requests per window, then resets', async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter({ now: () => now });
    const { limit, periodSeconds } = RATE_LIMITS.session;
    for (let i = 0; i < limit; i++) expect(await limiter.limit('session', 'ip')).toBe(true);
    expect(await limiter.limit('session', 'ip')).toBe(false);
    expect(await limiter.limit('session', 'other-ip')).toBe(true);
    now += periodSeconds * 1000;
    expect(await limiter.limit('session', 'ip')).toBe(true);
  });

  it('keeps memory bounded under a flood of distinct keys', async () => {
    const limiter = new MemoryRateLimiter({ maxKeys: 100 });
    for (let i = 0; i < 1000; i++) await limiter.limit('api', `ip-${String(i)}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
    expect(await limiter.limit('api', 'fresh')).toBe(true);
  });
});
