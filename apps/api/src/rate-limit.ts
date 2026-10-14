import { RATE_LIMITS, type RateLimitName } from '@drop-win/contract';

export interface RateLimiter {
  /** Resolves true when the request may proceed. */
  limit(name: RateLimitName, key: string): Promise<boolean>;
}

/**
 * Fixed-window counters held in memory. Fine for a single Node process; the
 * Worker uses Cloudflare's rate limiting binding with the same numbers.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();
  readonly #now: () => number;
  readonly #maxKeys: number;

  constructor(options: { now?: () => number; maxKeys?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxKeys = options.maxKeys ?? 50_000;
  }

  /** Number of tracked windows, exposed so tests can check memory stays bounded. */
  get size(): number {
    return this.#windows.size;
  }

  limit(name: RateLimitName, key: string): Promise<boolean> {
    const { limit, periodSeconds } = RATE_LIMITS[name];
    const now = this.#now();
    const id = `${name}:${key}`;
    let window = this.#windows.get(id);
    if (!window || window.resetAt <= now) {
      if (this.#windows.size >= this.#maxKeys) this.#sweep(now);
      window = { count: 0, resetAt: now + periodSeconds * 1000 };
      this.#windows.set(id, window);
    }
    window.count++;
    return Promise.resolve(window.count <= limit);
  }

  #sweep(now: number): void {
    for (const [id, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(id);
    }
    // Still full means a flood of distinct keys; drop the oldest entries
    // rather than grow without bound.
    const excess = this.#windows.size - Math.floor(this.#maxKeys / 2);
    if (excess > 0) {
      let removed = 0;
      for (const id of this.#windows.keys()) {
        if (removed++ >= excess) break;
        this.#windows.delete(id);
      }
    }
  }
}
