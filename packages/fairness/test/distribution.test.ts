import { describe, expect, it } from 'vitest';
import { bucketProbabilities, hmacSha256, pathFromDigest, bucketFromPath } from '../src/index.ts';
import { chiSquare } from '../scripts/chi-square.ts';

const DROPS = 100_000;

async function simulate(rows: number): Promise<number[]> {
  const counts = new Array<number>(rows + 1).fill(0);
  // Fixed seeds keep the test deterministic, so it can never flake.
  const serverSeed = '5b2c7f0e4a9d1386c2e7b5a0f9d84c3e1a6b2f7d0c9e8a5b4d3c2f1e0a9b8c7d';
  for (let nonce = 0; nonce < DROPS; nonce++) {
    const digest = await hmacSha256(serverSeed, `distribution-test:${String(nonce)}`);
    const bucket = bucketFromPath(pathFromDigest(digest, rows));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('bucket distribution over 100k drops', () => {
  for (const rows of [8, 16]) {
    it(`matches Binomial(${String(rows)}, 1/2) by chi-square at p = 0.001`, async () => {
      const counts = await simulate(rows);
      const result = chiSquare(counts, bucketProbabilities(rows));
      expect(result.statistic).toBeLessThan(result.critical);
    });
  }
});

describe('chi-square helper', () => {
  it('flags a clearly biased sample', () => {
    const p = bucketProbabilities(8);
    const biased = p.map((pk, k) => Math.round(pk * DROPS * (k < 4 ? 1.1 : 0.9)));
    const result = chiSquare(biased, p);
    expect(result.statistic).toBeGreaterThan(result.critical);
  });
});
