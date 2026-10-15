import { formatMultiplier } from '@drop-win/fairness';
import { type BoardGeometry, bucketX, NARROW_BUCKET, pegCount, pegX, pegY } from './geometry.ts';
import { brighten, bucketColor, labelColor, rgb } from './palette.ts';

export interface BoardTheme {
  peg: string;
  pegLit: string;
  ball: string;
  ballEdge: string;
  trace: string;
}

export interface Scene {
  table: readonly number[];
  balls: { x: number; y: number }[];
  /** Peg glow from 0 to 1, keyed by `${row}:${index}`. */
  litPegs: Map<string, number>;
  /** Bucket highlight from 0 to 1, keyed by bucket index. */
  litBuckets: Map<number, number>;
  trace?: { x: number; y: number }[];
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Sets the largest bold font (down to 7px) at which `text` fits in `maxWidth`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number) {
  let size = maxSize;
  for (; size > 7; size -= 0.5) {
    ctx.font = `700 ${String(size)}px system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return;
  }
  ctx.font = `700 ${String(size)}px system-ui, sans-serif`;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  g: BoardGeometry,
  theme: BoardTheme,
  scene: Scene,
) {
  ctx.clearRect(0, 0, g.width, g.height);

  for (let row = 0; row < g.rows; row++) {
    const y = pegY(g, row);
    for (let index = 0; index < pegCount(row); index++) {
      const glow = scene.litPegs.get(`${String(row)}:${String(index)}`) ?? 0;
      ctx.beginPath();
      ctx.arc(pegX(g, row, index), y, g.pegRadius * (1 + glow * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = glow > 0 ? theme.pegLit : theme.peg;
      ctx.globalAlpha = glow > 0 ? 0.55 + glow * 0.45 : 1;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  scene.table.forEach((hundredths, bucket) => {
    const lit = scene.litBuckets.get(bucket) ?? 0;
    const base = bucketColor(hundredths);
    const fill = brighten(base, lit * 0.35);
    const x = bucketX(g, bucket) - g.bucketWidth / 2;
    const y = g.bucketTop + lit * g.bucketHeight * 0.12;
    roundedRect(ctx, x, y, g.bucketWidth, g.bucketHeight, Math.min(6, g.bucketWidth * 0.18));
    ctx.fillStyle = rgb(fill);
    ctx.fill();
    const text = formatMultiplier(hundredths);
    ctx.fillStyle = rgb(labelColor(fill));
    if (g.spacing < NARROW_BUCKET) {
      // Sideways labels in tall buckets keep exact values readable on phones.
      ctx.save();
      ctx.translate(x + g.bucketWidth / 2, y + g.bucketHeight / 2);
      ctx.rotate(-Math.PI / 2);
      fitFont(ctx, text, g.bucketHeight - 4, Math.min(12, g.bucketWidth * 0.75));
      ctx.fillText(text, 0, 0.5);
      ctx.restore();
    } else {
      fitFont(ctx, text, g.bucketWidth - 3, Math.min(13, g.bucketHeight * 0.45));
      ctx.fillText(text, x + g.bucketWidth / 2, y + g.bucketHeight / 2 + 0.5);
    }
  });

  if (scene.trace && scene.trace.length > 1) {
    ctx.beginPath();
    scene.trace.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = theme.trace;
    ctx.lineWidth = Math.max(1.5, g.ballRadius * 0.35);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  for (const ball of scene.balls) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, g.ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = theme.ball;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.ballEdge;
    ctx.stroke();
  }
}
