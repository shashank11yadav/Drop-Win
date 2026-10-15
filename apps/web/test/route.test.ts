import { describe, expect, it } from 'vitest';
import { parseHash, parseVerifyParams, verifyHash } from '../src/lib/route.ts';

const seed = 'a'.repeat(64);
const hash = 'b'.repeat(64);

describe('routing', () => {
  it('maps hashes to pages', () => {
    expect(parseHash('').page).toBe('play');
    expect(parseHash('#/').page).toBe('play');
    expect(parseHash('#/verify?nonce=1').page).toBe('verify');
    expect(parseHash('#/elsewhere').page).toBe('play');
  });

  it('round-trips verify links', () => {
    const fields = {
      serverSeed: seed,
      serverSeedHash: hash,
      clientSeed: 'my-seed',
      nonce: 41,
      rows: 12 as const,
      risk: 'high' as const,
      expectedPath: 'LRLRLRLRLRLR',
      expectedMultiplier: 20,
    };
    const route = parseHash(verifyHash(fields));
    if (route.page !== 'verify') throw new Error('expected verify route');
    expect(parseVerifyParams(new URLSearchParams(route.query))).toEqual({ fields, rejected: [] });
  });

  it('drops and reports invalid fields without losing the valid ones', () => {
    const params = new URLSearchParams({
      serverSeed: 'not-hex',
      clientSeed: 'ok-seed',
      nonce: '-3',
      rows: '17',
      risk: 'extreme',
      path: 'LRX',
    });
    const { fields, rejected } = parseVerifyParams(params);
    expect(fields).toEqual({ clientSeed: 'ok-seed' });
    expect(rejected.sort()).toEqual(['nonce', 'path', 'risk', 'rows', 'serverSeed']);
  });

  it('ignores markup in parameters instead of passing it through', () => {
    const params = new URLSearchParams({ clientSeed: '<img src=x onerror=alert(1)>' });
    expect(parseVerifyParams(params).fields.clientSeed).toBeUndefined();
  });
});
