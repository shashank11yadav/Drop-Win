// Tiny synthesized sounds, so there are no audio files to load. The context is
// created lazily on the first user gesture, as browsers require.

let context: AudioContext | null = null;
let lastTick = 0;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, duration: number, volume: number, type: OscillatorType) {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

export function unlockAudio(): void {
  audio();
}

/** A short click per peg, rate limited so many balls do not turn into noise. */
export function playPeg(row: number): void {
  const now = performance.now();
  if (now - lastTick < 28) return;
  lastTick = now;
  tone(900 + row * 35, 0.035, 0.03, 'triangle');
}

/** Higher multipliers land on a higher, longer note. */
export function playLanding(multiplierHundredths: number): void {
  const step = Math.log2(Math.max(multiplierHundredths, 10) / 100);
  const frequency = Math.min(1400, Math.max(180, 440 * 2 ** (step / 3)));
  const win = multiplierHundredths >= 100;
  tone(frequency, win ? 0.32 : 0.14, win ? 0.09 : 0.05, win ? 'sine' : 'square');
  if (multiplierHundredths >= 1000) tone(frequency * 1.5, 0.4, 0.06, 'sine');
}
