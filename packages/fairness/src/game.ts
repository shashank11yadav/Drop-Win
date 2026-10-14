export const MIN_ROWS = 8;
export const MAX_ROWS = 16;

export const ROW_COUNTS = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export type RowCount = (typeof ROW_COUNTS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

/** Expected return per unit staked that every multiplier table is tuned to. */
export const TARGET_RTP = 0.99;

/** Largest allowed distance between a table's exact RTP and TARGET_RTP. */
export const RTP_TOLERANCE = 0.0001;

export function isRowCount(value: unknown): value is RowCount {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_ROWS && value <= MAX_ROWS
  );
}

export function isRisk(value: unknown): value is Risk {
  return typeof value === 'string' && (RISKS as readonly string[]).includes(value);
}
