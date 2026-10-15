/**
 * Board layout in CSS pixels, derived from the width alone so the board can
 * be redrawn at any size. Row r (0-based) has r + 3 pegs; there are rows + 1
 * buckets, centred between the pegs of the last row.
 */
export interface BoardGeometry {
  width: number;
  height: number;
  rows: number;
  spacing: number;
  rowGap: number;
  top: number;
  centerX: number;
  pegRadius: number;
  ballRadius: number;
  bucketTop: number;
  bucketHeight: number;
  bucketWidth: number;
}

/** Below this peg spacing (px) labels such as "37.9x" are drawn sideways in taller buckets. */
export const NARROW_BUCKET = 40;

export function layoutBoard(width: number, rows: number): BoardGeometry {
  const spacing = width / (rows + 2);
  const rowGap = spacing * 0.92;
  const top = spacing * 1.1;
  const pegRadius = Math.max(1.5, spacing * 0.11);
  const ballRadius = Math.max(3.5, spacing * 0.27);
  const lastRowY = top + (rows - 1) * rowGap;
  const bucketTop = lastRowY + rowGap * 0.75;
  // Narrow buckets get taller so their labels can be drawn sideways.
  const bucketHeight =
    spacing < NARROW_BUCKET ? Math.max(34, spacing * 2) : Math.max(22, spacing * 0.8);
  return {
    width,
    height: Math.ceil(bucketTop + bucketHeight + spacing * 0.4),
    rows,
    spacing,
    rowGap,
    top,
    centerX: width / 2,
    pegRadius,
    ballRadius,
    bucketTop,
    bucketHeight,
    bucketWidth: spacing * 0.86,
  };
}

export function pegCount(row: number): number {
  return row + 3;
}

export function pegX(g: BoardGeometry, row: number, index: number): number {
  return g.centerX + (index - (row + 2) / 2) * g.spacing;
}

export function pegY(g: BoardGeometry, row: number): number {
  return g.top + row * g.rowGap;
}

export function bucketX(g: BoardGeometry, bucket: number): number {
  return g.centerX + (bucket - g.rows / 2) * g.spacing;
}
