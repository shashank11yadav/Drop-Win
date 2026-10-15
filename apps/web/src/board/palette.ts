type Rgb = [number, number, number];

// Colour stops by log10(multiplier): losing buckets are cool, rare ones hot.
const STOPS: { at: number; color: Rgb }[] = [
  { at: Math.log10(0.2), color: [61, 76, 112] },
  { at: Math.log10(0.9), color: [66, 98, 150] },
  { at: Math.log10(1.5), color: [45, 190, 170] },
  { at: Math.log10(5), color: [240, 200, 60] },
  { at: Math.log10(40), color: [249, 140, 60] },
  { at: Math.log10(1000), color: [240, 70, 100] },
];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function bucketColor(multiplierHundredths: number): Rgb {
  const x = Math.log10(Math.max(multiplierHundredths, 1) / 100);
  const first = STOPS[0];
  const last = STOPS.at(-1);
  if (!first || !last) throw new Error('empty palette');
  if (x <= first.at) return first.color;
  if (x >= last.at) return last.color;
  for (let i = 1; i < STOPS.length; i++) {
    const lo = STOPS[i - 1];
    const hi = STOPS[i];
    if (lo && hi && x <= hi.at) return mix(lo.color, hi.color, (x - lo.at) / (hi.at - lo.at));
  }
  return last.color;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_TEXT: Rgb = [0, 0, 0];
const LIGHT_TEXT: Rgb = [255, 255, 255];

/**
 * Whichever of black or white reads better on the bucket colour. With pure
 * black and white the worse case is about 4.58:1, so any fill passes WCAG AA.
 */
export function labelColor(background: Rgb): Rgb {
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

export function rgb([r, g, b]: Rgb, alpha = 1): string {
  return `rgb(${String(Math.round(r))} ${String(Math.round(g))} ${String(Math.round(b))} / ${String(alpha)})`;
}

export function brighten(color: Rgb, amount: number): Rgb {
  return mix(color, [255, 255, 255], amount);
}
