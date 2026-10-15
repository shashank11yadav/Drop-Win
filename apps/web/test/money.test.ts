import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseAmountToCents } from '../src/lib/money.ts';

describe('parseAmountToCents', () => {
  it.each([
    ['1', 100],
    ['1.5', 150],
    ['1.05', 105],
    ['$2.50', 250],
    ['.1', 10],
    ['0.10', 10],
    ['  7 ', 700],
    ['1234567', 123_456_700],
    ['0.29', 29],
  ])('%s -> %i cents', (text, cents) => {
    expect(parseAmountToCents(text)).toBe(cents);
  });

  it.each(['', '.', 'abc', '1.234', '-1', '1e3', '1,000', '12345678', '$'])(
    'rejects %j',
    (text) => {
      expect(parseAmountToCents(text)).toBeNull();
    },
  );
});

describe('formatting', () => {
  it('formats cents as dollars with grouping', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123_456_789)).toBe('$1,234,567.89');
    expect(formatCents(-250)).toBe('-$2.50');
  });

  it('round-trips through the input format', () => {
    for (const cents of [10, 99, 100, 12_345, 50_000]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents);
    }
  });
});
