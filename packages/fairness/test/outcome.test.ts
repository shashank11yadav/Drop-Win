import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bucketFromPath,
  computeRound,
  hmacSha256,
  bytesToHex,
  pathFromDigest,
  randomSeedHex,
  sha256Hex,
} from '../src/index.ts';

const SERVER_SEED = 'a3f1c5e9d2b8470e96c3f0a1b2d4e6f8091a2b3c4d5e6f708192a3b4c5d6e7f8';

describe('known vectors', () => {
  // Expected digests were produced with openssl, independently of this code:
  //   printf '%s' 'player-seed:0' | openssl dgst -sha256 -hmac '<server seed>'
  it('hashes the server seed like shasum -a 256', async () => {
    expect(await sha256Hex(SERVER_SEED)).toBe(
      '614f4563ca0b64da228859760dbf293416d20592ae5f5582012f83eb78cad6ad',
    );
  });

  it('derives the documented digest, path and bucket for nonce 0', async () => {
    const round = await computeRound({
      serverSeed: SERVER_SEED,
      clientSeed: 'player-seed',
      nonce: 0,
      rows: 16,
      risk: 'medium',
    });
    expect(round.digestHex).toBe(
      'ef628d5ae6bdb951de0b2596bb5d9dd669b86feb0f30eba43a42ae8d6310f6e7',
    );
    // 0xef = 11101111, 0x62 = 01100010
    expect(round.path).toBe('RRRLRRRRLRRLLLRL');
    expect(round.bucket).toBe(10);
    expect(round.multiplierHundredths).toBe(68);
  });

  it('derives the documented digest, path and bucket for nonce 42', async () => {
    const round = await computeRound({
      serverSeed: SERVER_SEED,
      clientSeed: 'player-seed',
      nonce: 42,
      rows: 8,
      risk: 'high',
    });
    expect(round.digestHex).toBe(
      '4d0ed0b44cdec2ef14444bb1a5a03979d52591abf1271bf94bd60020c0e8a480',
    );
    // 0x4d = 01001101
    expect(round.path).toBe('LRLLRRLR');
    expect(round.bucket).toBe(4);
    expect(round.multiplierHundredths).toBe(20);
  });
});

describe('Web Crypto against node:crypto', () => {
  it('agrees on 500 random seeds and nonces', async () => {
    for (let i = 0; i < 500; i++) {
      const serverSeed = randomBytes(32).toString('hex');
      const message = `${randomBytes(8).toString('base64url')}:${String(i * 7919)}`;
      const expected = createHmac('sha256', serverSeed).update(message).digest('hex');
      expect(bytesToHex(await hmacSha256(serverSeed, message))).toBe(expected);
    }
  });

  it('agrees on sha256', async () => {
    const seed = randomSeedHex();
    expect(await sha256Hex(seed)).toBe(createHash('sha256').update(seed).digest('hex'));
  });
});

describe('path derivation', () => {
  it('reads bits most significant first across byte boundaries', () => {
    const digest = new Uint8Array([0b10000000, 0b00000001, 0xff]);
    expect(pathFromDigest(digest, 16)).toBe('RLLLLLLLLLLLLLLR');
    expect(pathFromDigest(digest, 9)).toBe('RLLLLLLLL');
  });

  it('counts right bounces as the bucket', () => {
    expect(bucketFromPath('LLLLLLLL')).toBe(0);
    expect(bucketFromPath('RRRRRRRRRRRRRRRR')).toBe(16);
    expect(bucketFromPath('RLRLRLRL')).toBe(4);
  });

  it('is deterministic and sensitive to every input', async () => {
    const base = {
      serverSeed: SERVER_SEED,
      clientSeed: 'c',
      nonce: 1,
      rows: 16,
      risk: 'low',
    } as const;
    const a = await computeRound(base);
    expect(await computeRound(base)).toEqual(a);
    expect((await computeRound({ ...base, nonce: 2 })).digestHex).not.toBe(a.digestHex);
    expect((await computeRound({ ...base, clientSeed: 'd' })).digestHex).not.toBe(a.digestHex);
    expect((await computeRound({ ...base, serverSeed: `${SERVER_SEED}0` })).digestHex).not.toBe(
      a.digestHex,
    );
  });

  it('uses a prefix of the same digest when only the row count changes', async () => {
    const base = { serverSeed: SERVER_SEED, clientSeed: 'c', nonce: 5, risk: 'low' } as const;
    const eight = await computeRound({ ...base, rows: 8 });
    const sixteen = await computeRound({ ...base, rows: 16 });
    expect(sixteen.path.startsWith(eight.path)).toBe(true);
  });

  it('rejects malformed input', async () => {
    const base = {
      serverSeed: SERVER_SEED,
      clientSeed: 'c',
      nonce: 0,
      rows: 8,
      risk: 'low',
    } as const;
    await expect(computeRound({ ...base, nonce: -1 })).rejects.toThrow(RangeError);
    await expect(computeRound({ ...base, nonce: 1.5 })).rejects.toThrow(RangeError);
    await expect(computeRound({ ...base, rows: 17 as 16 })).rejects.toThrow(RangeError);
    await expect(computeRound({ ...base, risk: 'wild' as 'low' })).rejects.toThrow(RangeError);
    await expect(computeRound({ ...base, clientSeed: '' })).rejects.toThrow(RangeError);
  });
});
