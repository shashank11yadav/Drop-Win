import { type BoardGeometry, bucketX, pegY } from './geometry.ts';

/** Time for the first fall onto the top peg, and for each hop after that. */
export const FIRST_FALL_MS = 300;
export const HOP_MS = 115;
export const FINAL_HOP_MS = 190;

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  duration: number;
  /** Initial upward speed of the hop, in pixels per unit of segment time. */
  lift: number;
}

export interface Trajectory {
  segments: Segment[];
  /** Milliseconds from release until the ball touches the peg on row i. */
  contactTimes: number[];
  duration: number;
  bucket: number;
}

export interface BallPosition {
  x: number;
  y: number;
  landed: boolean;
  /** Number of rows whose peg the ball has touched so far. */
  rowsTouched: number;
}

/**
 * The ball's route is fixed by the server's path before the animation starts:
 * it touches the top of one peg per row and ends in bucket = number of Rs.
 * Nothing here is simulated, so the picture cannot disagree with the result.
 */
export function buildTrajectory(g: BoardGeometry, path: string): Trajectory {
  const contactY = (row: number) => pegY(g, row) - g.pegRadius - g.ballRadius;
  // After `row` rows with `rights` right bounces the ball sits above a peg at this x.
  const contactX = (row: number, rights: number) => g.centerX + (rights - row / 2) * g.spacing;
  const lift = g.rowGap * 0.45;

  const segments: Segment[] = [];
  const contactTimes: number[] = [];
  let time = 0;
  let rights = 0;
  let x = g.centerX;
  let y = g.ballRadius + 1;

  for (let row = 0; row < g.rows; row++) {
    const nextX = contactX(row, rights);
    const nextY = contactY(row);
    const duration = row === 0 ? FIRST_FALL_MS : HOP_MS;
    segments.push({
      x0: x,
      y0: y,
      x1: nextX,
      y1: nextY,
      start: time,
      duration,
      lift: row === 0 ? 0 : lift,
    });
    time += duration;
    contactTimes.push(time);
    x = nextX;
    y = nextY;
    if (path[row] === 'R') rights++;
  }

  const finalX = bucketX(g, rights);
  // Rest just inside the top of the bucket, whatever its height.
  const finalY = g.bucketTop + Math.min(g.bucketHeight * 0.45, g.ballRadius * 1.6);
  segments.push({
    x0: x,
    y0: y,
    x1: finalX,
    y1: finalY,
    start: time,
    duration: FINAL_HOP_MS,
    lift,
  });
  time += FINAL_HOP_MS;

  return { segments, contactTimes, duration: time, bucket: rights };
}

export function positionAt(trajectory: Trajectory, elapsed: number): BallPosition {
  const { segments, contactTimes, duration } = trajectory;
  const rowsTouched = contactTimes.filter((t) => t <= elapsed).length;
  const last = segments.at(-1);
  if (!last) throw new Error('empty trajectory');
  if (elapsed >= duration) return { x: last.x1, y: last.y1, landed: true, rowsTouched };

  const segment = segments.find((s) => elapsed < s.start + s.duration) ?? last;
  const t = Math.max(0, (elapsed - segment.start) / segment.duration);
  // Ease-out sideways (the bounce kicks the ball off the peg), constant
  // gravity vertically: y(t) = y0 - lift*t + (y1 - y0 + lift)*t^2.
  const sideways = 1 - (1 - t) * (1 - t);
  return {
    x: segment.x0 + (segment.x1 - segment.x0) * sideways,
    y: segment.y0 - segment.lift * t + (segment.y1 - segment.y0 + segment.lift) * t * t,
    landed: false,
    rowsTouched,
  };
}
