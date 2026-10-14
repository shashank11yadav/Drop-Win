/** Row n of Pascal's triangle as exact integers. */
export function binomialRow(n: number): bigint[] {
  const row: bigint[] = [1n];
  for (let k = 0; k < n; k++) {
    // C(n, k+1) = C(n, k) * (n - k) / (k + 1), always exact in integers.
    row.push(((row[k] ?? 0n) * BigInt(n - k)) / BigInt(k + 1));
  }
  return row;
}

/** P(bucket = k) for n fair left/right decisions: C(n, k) / 2^n. */
export function bucketProbabilities(n: number): number[] {
  const total = 2 ** n;
  return binomialRow(n).map((c) => Number(c) / total);
}
