import { binomialRow } from './binomial.ts';
import type { Risk, RowCount } from './game.ts';
import { MULTIPLIER_TABLES } from './tables.generated.ts';

export function multiplierTable(risk: Risk, rows: RowCount): readonly number[] {
  return MULTIPLIER_TABLES[risk][rows];
}

export function multiplierFor(risk: Risk, rows: RowCount, bucket: number): number {
  const value = multiplierTable(risk, rows)[bucket];
  if (value === undefined) throw new RangeError(`bucket ${String(bucket)} out of range`);
  return value;
}

/**
 * Exact return-to-player of a table given in hundredths, as a fraction
 * numerator / denominator. Sum over k of C(n, k) * m_k / (100 * 2^n).
 */
export function exactRtp(table: readonly number[]): { numerator: bigint; denominator: bigint } {
  const n = table.length - 1;
  const coefficients = binomialRow(n);
  let numerator = 0n;
  table.forEach((m, k) => {
    numerator += (coefficients[k] ?? 0n) * BigInt(m);
  });
  return { numerator, denominator: 100n * 2n ** BigInt(n) };
}

export function rtp(table: readonly number[]): number {
  const { numerator, denominator } = exactRtp(table);
  return Number(numerator) / Number(denominator);
}

/**
 * Payout in integer cents. Rounds down so a payout can never exceed the exact
 * value; the bet amount and multiplier are both integers, so this is the only
 * place rounding happens.
 */
export function payoutCents(amountCents: number, multiplierHundredths: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError('amount must be a non-negative integer number of cents');
  }
  return Math.floor((amountCents * multiplierHundredths) / 100);
}

export function formatMultiplier(hundredths: number): string {
  const value = hundredths / 100;
  if (hundredths >= 10_000) return `${value.toFixed(0)}x`;
  if (hundredths >= 1_000) return `${value.toFixed(1).replace(/\.0$/, '')}x`;
  return `${value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}x`;
}
