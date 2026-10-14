import { bytesToHex, hmacSha256 } from './crypto.ts';
import { isRisk, isRowCount, type Risk, type RowCount } from './game.ts';
import { multiplierFor } from './multipliers.ts';

export type Direction = 'L' | 'R';

export interface RoundInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  rows: RowCount;
  risk: Risk;
}

export interface RoundResult {
  /** HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) as hex. */
  digestHex: string;
  /** One letter per row, top to bottom. */
  path: string;
  /** Number of right bounces, 0 (far left) to rows (far right). */
  bucket: number;
  /** Multiplier in hundredths, so 150 means 1.5x. */
  multiplierHundredths: number;
}

export function roundMessage(clientSeed: string, nonce: number): string {
  return `${clientSeed}:${String(nonce)}`;
}

/**
 * Reads the first `rows` bits of the digest, most significant bit of each byte
 * first. A 1 bit bounces right, a 0 bit bounces left. Each bit of an HMAC
 * output is an independent fair coin, so the bucket is Binomial(rows, 1/2).
 */
export function pathFromDigest(digest: Uint8Array, rows: number): string {
  if (rows > digest.length * 8) throw new RangeError('digest too short for row count');
  let path = '';
  for (let i = 0; i < rows; i++) {
    const byte = digest[i >> 3] ?? 0;
    path += (byte >> (7 - (i & 7))) & 1 ? 'R' : 'L';
  }
  return path;
}

export function bucketFromPath(path: string): number {
  let rights = 0;
  for (const step of path) if (step === 'R') rights++;
  return rights;
}

export function resultFromDigest(digest: Uint8Array, rows: RowCount, risk: Risk): RoundResult {
  const path = pathFromDigest(digest, rows);
  const bucket = bucketFromPath(path);
  return {
    digestHex: bytesToHex(digest),
    path,
    bucket,
    multiplierHundredths: multiplierFor(risk, rows, bucket),
  };
}

export async function computeRound(input: RoundInput): Promise<RoundResult> {
  if (!isRowCount(input.rows)) throw new RangeError(`unsupported row count: ${String(input.rows)}`);
  if (!isRisk(input.risk)) throw new RangeError(`unsupported risk: ${String(input.risk)}`);
  if (!Number.isSafeInteger(input.nonce) || input.nonce < 0) {
    throw new RangeError('nonce must be a non-negative integer');
  }
  if (input.serverSeed.length === 0 || input.clientSeed.length === 0) {
    throw new RangeError('seeds must not be empty');
  }
  const digest = await hmacSha256(input.serverSeed, roundMessage(input.clientSeed, input.nonce));
  return resultFromDigest(digest, input.rows, input.risk);
}
