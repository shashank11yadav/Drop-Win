// Drops balls through the real outcome derivation and reports how closely the
// buckets follow the binomial distribution and how the tables pay out.
//
//   node scripts/simulate.ts [drops=100000]

import { randomSeedHex } from '../src/crypto.ts';
import { bucketProbabilities } from '../src/binomial.ts';
import { RISKS, ROW_COUNTS } from '../src/game.ts';
import { multiplierTable, rtp } from '../src/multipliers.ts';
import { bucketFromPath, pathFromDigest } from '../src/outcome.ts';
import { hmacSha256 } from '../src/crypto.ts';
import { chiSquare } from './chi-square.ts';

const drops = Number(process.argv[2] ?? 100_000);
const serverSeed = randomSeedHex();
const clientSeed = 'simulation';

// One digest per nonce is enough for every row count: rows only decide how many bits are read.
const digests: Uint8Array[] = [];
for (let nonce = 0; nonce < drops; nonce++) {
  digests.push(await hmacSha256(serverSeed, `${clientSeed}:${String(nonce)}`));
}

console.log(`${String(drops)} drops, random server seed\n`);
console.log('rows  chi2     df  critical(p=.001)  sim RTP low / medium / high   exact RTP');
for (const rows of ROW_COUNTS) {
  const counts = new Array<number>(rows + 1).fill(0);
  for (const digest of digests) {
    const bucket = bucketFromPath(pathFromDigest(digest, rows));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const result = chiSquare(counts, bucketProbabilities(rows));
  const simulated = RISKS.map((risk) => {
    const table = multiplierTable(risk, rows);
    const paid = counts.reduce((sum, c, k) => sum + c * (table[k] ?? 0), 0);
    return ((paid / 100 / drops) * 100).toFixed(2).padStart(6);
  });
  const exact = RISKS.map((risk) => (rtp(multiplierTable(risk, rows)) * 100).toFixed(3));
  console.log(
    `${String(rows).padStart(4)}  ${result.statistic.toFixed(2).padStart(6)}  ${String(result.degreesOfFreedom).padStart(3)}  ${result.critical.toFixed(2).padStart(16)}  ${simulated.join(' / ')}%   ${exact.join(' / ')}%`,
  );
}
