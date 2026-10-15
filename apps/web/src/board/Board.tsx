import { formatMultiplier } from '@drop-win/fairness';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type BoardGeometry, layoutBoard } from './geometry.ts';
import { type BoardTheme, drawScene, type Scene } from './renderer.ts';
import { buildTrajectory, positionAt, type Trajectory } from './trajectory.ts';

export interface Flight {
  id: number;
  path: string;
  bucket: number;
}

interface BoardProps {
  rows: number;
  table: readonly number[];
  flights: readonly Flight[];
  reducedMotion: boolean;
  onLand?: (id: number) => void;
  onPegTouch?: (row: number) => void;
  /** Draws one path as a static line instead of animating balls (verifier page). */
  trace?: string;
  label: string;
}

const PEG_GLOW_MS = 220;
const BUCKET_GLOW_MS = 650;
const MAX_WIDTH = 760;
const MIN_HEIGHT = 300;

/** Shrinks the board when it would be taller than most of the viewport. */
function fitBoard(available: number, rows: number): BoardGeometry {
  const full = layoutBoard(available, rows);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight * 0.7);
  if (full.height <= maxHeight) return full;
  return layoutBoard(Math.floor((available * maxHeight) / full.height), rows);
}

function readTheme(element: HTMLElement): BoardTheme {
  const style = getComputedStyle(element);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    peg: get('--board-peg', '#8b95b8'),
    pegLit: get('--board-peg-lit', '#ffffff'),
    ball: get('--board-ball', '#ffcb47'),
    ballEdge: get('--board-ball-edge', '#a86b00'),
    trace: get('--board-trace', '#ffcb47'),
  };
}

interface Tracked {
  trajectory: Trajectory;
  path: string;
  start: number;
  rowsTouched: number;
  landed: boolean;
}

export function Board({
  rows,
  table,
  flights,
  reducedMotion,
  onLand,
  onPegTouch,
  trace,
  label,
}: BoardProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [theme, setTheme] = useState<BoardTheme | null>(null);
  const geometry = useMemo(() => (width > 0 ? fitBoard(width, rows) : null), [width, rows]);

  // Mutable animation state lives in refs so the frame loop never waits on a render.
  const tracked = useRef(new Map<number, Tracked>());
  const bucketHits = useRef(new Map<number, number>());
  const frame = useRef<number | null>(null);
  const callbacks = useRef({ onLand, onPegTouch });
  useEffect(() => {
    callbacks.current = { onLand, onPegTouch };
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.min(MAX_WIDTH, Math.floor(entry.contentRect.width)));
    });
    observer.observe(wrapper);
    setTheme(readTheme(wrapper));
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      setTheme(readTheme(wrapper));
    };
    scheme.addEventListener('change', onScheme);
    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', onScheme);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !geometry || !theme) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(geometry.width * dpr);
    canvas.height = Math.round(geometry.height * dpr);
    canvas.style.width = `${String(geometry.width)}px`;
    canvas.style.height = `${String(geometry.height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const g: BoardGeometry = geometry;
    const now = performance.now();
    const live = tracked.current;

    // Register new flights. Geometry can change mid-flight (resize), so the
    // trajectory is rebuilt here; positions only depend on elapsed time.
    const ids = new Set<number>();
    for (const flight of flights) {
      ids.add(flight.id);
      const existing = live.get(flight.id);
      const trajectory = buildTrajectory(g, flight.path);
      if (existing) existing.trajectory = trajectory;
      else {
        live.set(flight.id, {
          trajectory,
          path: flight.path,
          start: now,
          rowsTouched: 0,
          landed: false,
        });
      }
    }
    for (const id of live.keys()) if (!ids.has(id)) live.delete(id);

    const traceScene = trace ? buildTraceScene(g, trace) : undefined;

    const render = (time: number) => {
      const scene: Scene = {
        table,
        balls: [],
        litPegs: new Map(),
        litBuckets: new Map(),
        ...(traceScene ? { trace: traceScene.points } : {}),
      };
      const landedNow: number[] = [];

      for (const [id, ball] of live) {
        if (ball.landed) continue;
        const elapsed = reducedMotion ? ball.trajectory.duration : time - ball.start;
        const position = positionAt(ball.trajectory, elapsed);
        if (!reducedMotion) {
          for (let row = ball.rowsTouched; row < position.rowsTouched; row++) {
            callbacks.current.onPegTouch?.(row);
          }
          markPegs(scene.litPegs, ball.trajectory, elapsed, ball.path);
        }
        ball.rowsTouched = position.rowsTouched;
        if (position.landed) {
          ball.landed = true;
          bucketHits.current.set(ball.trajectory.bucket, time);
          landedNow.push(id);
        } else {
          scene.balls.push(position);
        }
      }

      for (const [bucket, at] of bucketHits.current) {
        const age = time - at;
        if (age >= BUCKET_GLOW_MS) bucketHits.current.delete(bucket);
        else scene.litBuckets.set(bucket, reducedMotion ? 1 : 1 - age / BUCKET_GLOW_MS);
      }
      if (traceScene) {
        scene.balls.push(traceScene.end);
        scene.litBuckets.set(traceScene.bucket, 1);
      }

      drawScene(ctx, g, theme, scene);
      for (const id of landedNow) callbacks.current.onLand?.(id);

      const busy = [...live.values()].some((b) => !b.landed) || bucketHits.current.size > 0;
      frame.current = busy ? requestAnimationFrame(render) : null;
    };

    if (frame.current !== null) cancelAnimationFrame(frame.current);
    render(now);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [geometry, theme, flights, table, trace, reducedMotion]);

  const multipliers = table.map(formatMultiplier).join(', ');
  return (
    <div ref={wrapperRef} className="board">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${label} Bucket multipliers from left to right: ${multipliers}.`}
      />
    </div>
  );
}

function markPegs(lit: Map<string, number>, trajectory: Trajectory, elapsed: number, path: string) {
  let rights = 0;
  trajectory.contactTimes.forEach((touchedAt, row) => {
    const age = elapsed - touchedAt;
    if (age >= 0 && age < PEG_GLOW_MS) {
      const key = `${String(row)}:${String(rights + 1)}`;
      lit.set(key, Math.max(lit.get(key) ?? 0, 1 - age / PEG_GLOW_MS));
    }
    if (path[row] === 'R') rights++;
  });
}

function buildTraceScene(g: BoardGeometry, path: string) {
  const trajectory = buildTrajectory(g, path);
  const points = [];
  // Stop the line where the ball reaches the bucket so its label stays readable.
  const restY = g.bucketTop - g.ballRadius - 1;
  for (let t = 0; t <= trajectory.duration; t += 8) {
    const point = positionAt(trajectory, t);
    if (point.y > restY) break;
    points.push(point);
  }
  const landed = positionAt(trajectory, trajectory.duration);
  const end = { x: landed.x, y: restY };
  points.push(end);
  return { points, end, bucket: trajectory.bucket };
}
