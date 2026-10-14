// Upper critical values of the chi-square distribution at p = 0.001, by degrees of freedom.
const CRITICAL_P001 = [
  Number.NaN,
  10.828,
  13.816,
  16.266,
  18.467,
  20.515,
  22.458,
  24.322,
  26.124,
  27.877,
  29.588,
  31.264,
  32.909,
  34.528,
  36.123,
  37.697,
  39.252,
];

export interface ChiSquareResult {
  statistic: number;
  degreesOfFreedom: number;
  critical: number;
}

/**
 * Pearson's chi-square goodness of fit. Adjacent buckets are pooled from the
 * edges inward until each group expects at least 5 hits, the usual rule for
 * the approximation to hold.
 */
export function chiSquare(observed: number[], probabilities: number[]): ChiSquareResult {
  const total = observed.reduce((a, b) => a + b, 0);
  const groups: { observed: number; expected: number }[] = [];
  let pending = { observed: 0, expected: 0 };
  probabilities.forEach((p, k) => {
    pending.observed += observed[k] ?? 0;
    pending.expected += p * total;
    if (pending.expected >= 5) {
      groups.push(pending);
      pending = { observed: 0, expected: 0 };
    }
  });
  const last = groups.at(-1);
  if (pending.expected > 0 && last) {
    last.observed += pending.observed;
    last.expected += pending.expected;
  }
  const statistic = groups.reduce((sum, g) => sum + (g.observed - g.expected) ** 2 / g.expected, 0);
  const degreesOfFreedom = groups.length - 1;
  const critical = CRITICAL_P001[degreesOfFreedom];
  if (critical === undefined) throw new RangeError('no critical value for this many groups');
  return { statistic, degreesOfFreedom, critical };
}
