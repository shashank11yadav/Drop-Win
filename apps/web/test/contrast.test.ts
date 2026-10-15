import { readFileSync } from 'node:fs';
import { multiplierTable, RISKS, ROW_COUNTS } from '@drop-win/fairness';
import { describe, expect, it } from 'vitest';
import { brighten, bucketColor, contrastRatio, labelColor } from '../src/board/palette.ts';

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
  if (!match) throw new Error(`not a hex colour: ${value}`);
  return [parseInt(match[1] ?? '', 16), parseInt(match[2] ?? '', 16), parseInt(match[3] ?? '', 16)];
}

/** Reads the custom properties of the first `:root {` block after `marker`. */
function tokens(css: string, marker: string): Record<string, Rgb> {
  const start = css.indexOf(':root {', css.indexOf(marker));
  const block = css.slice(start, css.indexOf('}', start));
  const result: Record<string, Rgb> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    if (name && value) result[name] = hex(value);
  }
  return result;
}

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const themes = { dark: tokens(css, ''), light: tokens(css, 'prefers-color-scheme: light') };

// WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text and UI components.
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-raised', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-raised', 4.5],
  ['muted', 'bg', 4.5],
  ['accent-text', 'accent', 4.5],
  ['win', 'surface', 4.5],
  ['loss', 'surface', 4.5],
  ['focus', 'surface', 3],
  // Links use the focus colour, including the demo banner's on surface-raised.
  ['focus', 'surface-raised', 4.5],
  ['focus', 'bg', 3],
  ['board-peg', 'surface', 3],
  ['board-ball', 'surface', 3],
];

describe.each(Object.entries(themes))('%s theme', (_name, theme) => {
  it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, minimum) => {
    const a = theme[fg];
    const b = theme[bg];
    if (!a || !b) throw new Error(`missing token ${fg} or ${bg}`);
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(minimum);
  });
});

describe('bucket labels', () => {
  it('are readable on every bucket colour, lit or not', () => {
    for (const risk of RISKS) {
      for (const rows of ROW_COUNTS) {
        for (const m of multiplierTable(risk, rows)) {
          for (const lit of [0, 0.35]) {
            const fill = brighten(bucketColor(m), lit);
            expect(contrastRatio(fill, labelColor(fill))).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});
