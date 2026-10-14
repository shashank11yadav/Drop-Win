import { binomialRow, bucketProbabilities } from './binomial.ts';
import type { Risk } from './game.ts';

/**
 * Shape of each risk level.
 * floor: multiplier paid on the most likely bucket(s).
 * tail: how strongly rarity is rewarded (exponent on 1 / probability).
 */
export const RISK_SHAPES: Record<Risk, { floor: number; tail: number }> = {
  low: { floor: 0.5, tail: 0.4 },
  medium: { floor: 0.3, tail: 0.6 },
  high: { floor: 0.2, tail: 0.75 },
};

/**
 * Continuous multipliers before rounding:
 *   m_k = floor + b * (P_k^-tail - P_max^-tail)
 * The centre bucket pays exactly `floor`, rarer buckets pay more, and b is
 * solved in closed form so that sum(P_k * m_k) equals the target RTP.
 */
export function idealMultipliers(rows: number, risk: Risk, targetRtp: number): number[] {
  const { floor, tail } = RISK_SHAPES[risk];
  const p = bucketProbabilities(rows);
  const pMax = Math.max(...p);
  const weight = (pk: number) => pk ** -tail - pMax ** -tail;
  const spread = p.reduce((sum, pk) => sum + pk * weight(pk), 0);
  const b = (targetRtp - floor) / spread;
  return p.map((pk) => floor + b * weight(pk));
}

/** Rounds to what a player would expect to read: 0.37x, 13.5x, 420x. Returns hundredths. */
export function roundToDisplay(multiplier: number): number {
  if (multiplier < 10) return Math.round(multiplier * 100);
  if (multiplier < 100) return Math.round(multiplier * 10) * 10;
  return Math.round(multiplier) * 100;
}

/** Smallest change that keeps a value (in hundredths) at its display precision. */
function displayStep(hundredths: number): number {
  if (hundredths < 1_000) return 1;
  if (hundredths < 10_000) return 10;
  return 100;
}

function centreIndices(rows: number): number[] {
  return rows % 2 === 0 ? [rows / 2] : [(rows - 1) / 2, (rows + 1) / 2];
}

/** Indices of the symmetric pair `ring` steps outside the centre. */
function ringIndices(rows: number, ring: number): [number, number] {
  const [left] = centreIndices(rows);
  const right = rows - (left ?? 0);
  return [(left ?? 0) - ring, right + ring];
}

function isValidShape(table: readonly number[]): boolean {
  const n = table.length - 1;
  for (let k = 0; k <= n; k++) {
    if (table[k] !== table[n - k]) return false;
    if ((table[k] ?? 0) <= 0) return false;
  }
  const [left = 0] = centreIndices(n);
  for (let k = left; k > 0; k--) {
    if ((table[k - 1] ?? 0) < (table[k] ?? 0)) return false;
  }
  return true;
}

/**
 * Rounding moves the RTP a little away from the target. The four rings next
 * to the centre carry most of the probability mass, so nudging them by a few
 * display steps (0.01x below 10x, 0.1x below 100x) pulls the exact RTP back.
 * A small exhaustive search picks the nudge with the smallest error, then the
 * smallest total change.
 */
export function designTable(rows: number, risk: Risk, targetRtp: number): number[] {
  const base = idealMultipliers(rows, risk, targetRtp).map(roundToDisplay);
  const coefficients = binomialRow(rows);
  const denominator = 100n * 2n ** BigInt(rows);
  const target = BigInt(Math.round(targetRtp * 1_000_000)) * denominator;

  const rings = [1, 2, 3, 4].filter((ring) => ringIndices(rows, ring)[0] >= 0);
  const span = 5;
  let best: { table: number[]; error: bigint; change: number } | undefined;

  const visit = (depth: number, deltas: number[]) => {
    if (depth === rings.length) {
      const table = [...base];
      rings.forEach((ring, i) => {
        for (const index of ringIndices(rows, ring)) {
          const value = table[index] ?? 0;
          table[index] = value + (deltas[i] ?? 0) * displayStep(value);
        }
      });
      if (!isValidShape(table)) return;
      let numerator = 0n;
      table.forEach((m, k) => {
        numerator += (coefficients[k] ?? 0n) * BigInt(m);
      });
      const diff = numerator * 1_000_000n - target;
      const error = diff < 0n ? -diff : diff;
      const change = deltas.reduce((sum, d) => sum + Math.abs(d), 0);
      if (!best || error < best.error || (error === best.error && change < best.change)) {
        best = { table, error, change };
      }
      return;
    }
    for (let d = -span; d <= span; d++) visit(depth + 1, [...deltas, d]);
  };
  visit(0, []);

  if (!best) throw new Error(`no valid table for rows=${String(rows)} risk=${risk}`);
  return best.table;
}
