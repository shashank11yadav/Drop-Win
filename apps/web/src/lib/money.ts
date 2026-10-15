const AMOUNT_PATTERN = /^\$?\s*(\d{0,7})(?:\.(\d{0,2}))?$/;

/**
 * Parses what a person types ("5", "$2.50", ".1") into integer cents using
 * string arithmetic, so 0.1 + 0.2 style float errors cannot creep in.
 */
export function parseAmountToCents(text: string): number | null {
  const match = AMOUNT_PATTERN.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
}

/** Integer cents to "$1,234.56" without dividing by 100 in floating point. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}`;
}

/** Integer cents to the plain "12.50" shown in the bet input. */
export function centsToInput(cents: number): string {
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`;
}
