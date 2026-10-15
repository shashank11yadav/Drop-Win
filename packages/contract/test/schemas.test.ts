import { describe, expect, it } from 'vitest';
import {
  BetRequest,
  ClientSeed,
  IdempotencyKey,
  MAX_BET_CENTS,
  MIN_BET_CENTS,
  RotateSeedRequest,
  staticPageCsp,
  webSecurityHeaders,
} from '../src/index.ts';

const valid = { amountCents: 100, rows: 16, risk: 'medium' };

describe('BetRequest', () => {
  it('accepts a well-formed bet', () => {
    expect(BetRequest.safeParse(valid).success).toBe(true);
    expect(BetRequest.safeParse({ ...valid, amountCents: MIN_BET_CENTS }).success).toBe(true);
    expect(BetRequest.safeParse({ ...valid, amountCents: MAX_BET_CENTS }).success).toBe(true);
  });

  it.each([
    ['below minimum', { amountCents: MIN_BET_CENTS - 1 }],
    ['above maximum', { amountCents: MAX_BET_CENTS + 1 }],
    ['zero', { amountCents: 0 }],
    ['negative', { amountCents: -100 }],
    ['fractional cents', { amountCents: 10.5 }],
    ['numeric string', { amountCents: '100' }],
    ['NaN', { amountCents: Number.NaN }],
    ['too few rows', { rows: 7 }],
    ['too many rows', { rows: 17 }],
    ['fractional rows', { rows: 8.5 }],
    ['unknown risk', { risk: 'extreme' }],
    ['extra field', { multiplier: 1000 }],
  ])('rejects %s', (_label, patch) => {
    expect(BetRequest.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(BetRequest.safeParse({ amountCents: 100 }).success).toBe(false);
    expect(BetRequest.safeParse(null).success).toBe(false);
  });
});

describe('seeds and keys', () => {
  it('limits client seeds to 1-64 URL-safe characters', () => {
    expect(ClientSeed.safeParse('my_seed-42').success).toBe(true);
    expect(ClientSeed.safeParse('').success).toBe(false);
    expect(ClientSeed.safeParse('a'.repeat(65)).success).toBe(false);
    expect(ClientSeed.safeParse('has space').success).toBe(false);
    expect(ClientSeed.safeParse('colon:breaks:message').success).toBe(false);
    expect(RotateSeedRequest.safeParse({ clientSeed: 'ok', extra: 1 }).success).toBe(false);
  });

  it('requires idempotency keys to be UUIDs', () => {
    expect(IdempotencyKey.safeParse('0b8e3a5c-3f5d-4c1e-9a77-5d2f1f0e6b1a').success).toBe(true);
    expect(IdempotencyKey.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('webSecurityHeaders', () => {
  it('locks scripts to the same origin and adds a separate API origin only to connect-src', () => {
    const csp = webSecurityHeaders('https://api.example.com')['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    expect(csp).not.toContain('unsafe-inline');
  });
});

describe('staticPageCsp', () => {
  it('keeps the meta-tag policy same-origin and free of directives a meta tag ignores', () => {
    const csp = staticPageCsp();
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toMatch(/unsafe-|frame-ancestors|report-uri|sandbox|https?:/);
  });
});
