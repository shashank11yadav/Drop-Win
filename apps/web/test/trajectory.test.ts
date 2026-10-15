import { bucketFromPath } from '@drop-win/fairness';
import { describe, expect, it } from 'vitest';
import { bucketX, layoutBoard, pegCount, pegX, pegY } from '../src/board/geometry.ts';
import { buildTrajectory, positionAt } from '../src/board/trajectory.ts';

function allPaths(rows: number): string[] {
  return Array.from({ length: 2 ** rows }, (_, n) =>
    n.toString(2).padStart(rows, '0').replaceAll('0', 'L').replaceAll('1', 'R'),
  );
}

function randomPath(rows: number): string {
  return Array.from({ length: rows }, () => (Math.random() < 0.5 ? 'L' : 'R')).join('');
}

const WIDTHS = [343, 720];

describe('trajectory', () => {
  it.each(WIDTHS)('lands every 8-row path in the bucket the server named (width %i)', (width) => {
    const g = layoutBoard(width, 8);
    for (const path of allPaths(8)) {
      const trajectory = buildTrajectory(g, path);
      const end = positionAt(trajectory, trajectory.duration);
      const bucket = bucketFromPath(path);
      expect(trajectory.bucket).toBe(bucket);
      expect(end.landed).toBe(true);
      expect(Math.abs(end.x - bucketX(g, bucket))).toBeLessThan(1e-9);
      expect(end.y).toBeGreaterThan(g.bucketTop);
    }
  });

  it.each([9, 12, 16])('lands random %i-row paths in the right bucket', (rows) => {
    const g = layoutBoard(500, rows);
    for (let i = 0; i < 500; i++) {
      const path = randomPath(rows);
      const trajectory = buildTrajectory(g, path);
      const end = positionAt(trajectory, trajectory.duration + 1);
      expect(Math.abs(end.x - bucketX(g, bucketFromPath(path)))).toBeLessThan(1e-9);
    }
  });

  it('touches the top of exactly the peg the path implies on every row', () => {
    const g = layoutBoard(600, 16);
    for (let i = 0; i < 200; i++) {
      const path = randomPath(16);
      const trajectory = buildTrajectory(g, path);
      let rights = 0;
      trajectory.contactTimes.forEach((time, row) => {
        const at = positionAt(trajectory, time);
        expect(at.x).toBeCloseTo(pegX(g, row, rights + 1), 9);
        expect(at.y).toBeCloseTo(pegY(g, row) - g.pegRadius - g.ballRadius, 9);
        if (path[row] === 'R') rights++;
      });
    }
  });

  it('never passes through a peg', () => {
    for (const rows of [8, 16]) {
      const g = layoutBoard(375, rows);
      const minDistance = g.pegRadius + g.ballRadius - 0.01;
      let closest = Infinity;
      for (let i = 0; i < 40; i++) {
        const trajectory = buildTrajectory(g, randomPath(rows));
        for (let t = 0; t <= trajectory.duration; t += 2) {
          const { x, y } = positionAt(trajectory, t);
          for (let row = 0; row < rows; row++) {
            for (let index = 0; index < pegCount(row); index++) {
              closest = Math.min(closest, Math.hypot(x - pegX(g, row, index), y - pegY(g, row)));
            }
          }
        }
      }
      expect(closest).toBeGreaterThanOrEqual(minDistance);
    }
  });

  it('counts rows touched over time and starts at the top centre', () => {
    const g = layoutBoard(400, 10);
    const trajectory = buildTrajectory(g, 'LRLRLRLRLR');
    const start = positionAt(trajectory, 0);
    expect(start.x).toBe(g.centerX);
    expect(start.rowsTouched).toBe(0);
    const middle = trajectory.contactTimes[4] ?? 0;
    expect(positionAt(trajectory, middle).rowsTouched).toBe(5);
    expect(positionAt(trajectory, trajectory.duration).rowsTouched).toBe(10);
  });
});

describe('layout', () => {
  it('fits every peg and bucket inside the canvas at phone width', () => {
    for (let rows = 8; rows <= 16; rows++) {
      const g = layoutBoard(343, rows);
      for (let row = 0; row < rows; row++) {
        expect(pegX(g, row, 0) - g.pegRadius).toBeGreaterThan(0);
        expect(pegX(g, row, pegCount(row) - 1) + g.pegRadius).toBeLessThan(g.width);
      }
      expect(bucketX(g, 0) - g.bucketWidth / 2).toBeGreaterThan(0);
      expect(bucketX(g, rows) + g.bucketWidth / 2).toBeLessThan(g.width);
      expect(g.bucketTop + g.bucketHeight).toBeLessThan(g.height);
    }
  });
});
