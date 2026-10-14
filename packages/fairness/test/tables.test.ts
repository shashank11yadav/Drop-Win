import { describe, expect, it } from 'vitest';
import {
  bucketProbabilities,
  formatMultiplier,
  multiplierTable,
  payoutCents,
  RISKS,
  ROW_COUNTS,
  RTP_TOLERANCE,
  rtp,
  TARGET_RTP,
} from '../src/index.ts';
import { designTable, idealMultipliers } from '../src/table-design.ts';

describe.each(RISKS)('%s risk tables', (risk) => {
  it.each(ROW_COUNTS)('%i rows: RTP within tolerance of the target', (rows) => {
    const table = multiplierTable(risk, rows);
    expect(table).toHaveLength(rows + 1);
    expect(Math.abs(rtp(table) - TARGET_RTP)).toBeLessThanOrEqual(RTP_TOLERANCE);
  });

  it.each(ROW_COUNTS)('%i rows: symmetric, positive, rising toward the edges', (rows) => {
    const table = multiplierTable(risk, rows);
    table.forEach((m, k) => {
      expect(Number.isInteger(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
      expect(m).toBe(table[rows - k]);
    });
    for (let k = 1; k <= rows / 2; k++) {
      expect(table[k - 1]).toBeGreaterThanOrEqual(table[k] ?? Infinity);
    }
  });

  it.each(ROW_COUNTS)('%i rows: committed table matches the generator', (rows) => {
    expect(multiplierTable(risk, rows)).toEqual(designTable(rows, risk, TARGET_RTP));
  });

  it.each(ROW_COUNTS)('%i rows: unrounded design hits the target exactly', (rows) => {
    const ideal = idealMultipliers(rows, risk, TARGET_RTP);
    const p = bucketProbabilities(rows);
    const value = ideal.reduce((sum, m, k) => sum + m * (p[k] ?? 0), 0);
    expect(value).toBeCloseTo(TARGET_RTP, 12);
  });
});

describe('higher risk means higher variance', () => {
  it.each(ROW_COUNTS)('%i rows', (rows) => {
    const p = bucketProbabilities(rows);
    const variance = (risk: (typeof RISKS)[number]) =>
      multiplierTable(risk, rows).reduce(
        (sum, m, k) => sum + (p[k] ?? 0) * (m / 100 - TARGET_RTP) ** 2,
        0,
      );
    expect(variance('low')).toBeLessThan(variance('medium'));
    expect(variance('medium')).toBeLessThan(variance('high'));
  });
});

describe('payoutCents', () => {
  it('multiplies in integers and rounds down', () => {
    expect(payoutCents(100, 150)).toBe(150);
    expect(payoutCents(10, 25)).toBe(2);
    expect(payoutCents(333, 33)).toBe(109);
    expect(payoutCents(50_000, 108_500)).toBe(54_250_000);
  });

  it('rejects fractional or negative amounts', () => {
    expect(() => payoutCents(1.5, 100)).toThrow(RangeError);
    expect(() => payoutCents(-1, 100)).toThrow(RangeError);
  });
});

describe('formatMultiplier', () => {
  it.each([
    [20, '0.2x'],
    [29, '0.29x'],
    [100, '1x'],
    [150, '1.5x'],
    [1350, '13.5x'],
    [1000, '10x'],
    [108_500, '1085x'],
  ])('%i -> %s', (hundredths, text) => {
    expect(formatMultiplier(hundredths)).toBe(text);
  });
});
