/** All money is integer cents. $0.10 minimum, $500 maximum, $1,000 starting balance. */
export const MIN_BET_CENTS = 10;
export const MAX_BET_CENTS = 50_000;
export const STARTING_BALANCE_CENTS = 100_000;

export const HISTORY_PAGE_SIZE = 25;

/** Kept to URL-safe characters so seeds can travel in verify links without escaping. */
export const CLIENT_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Requests per window, shared by the in-memory limiter and wrangler.jsonc. */
export const RATE_LIMITS = {
  /** Every API request, keyed by client IP. */
  api: { limit: 300, periodSeconds: 60 },
  /** New sessions, keyed by client IP. */
  session: { limit: 20, periodSeconds: 60 },
  /** Bets, keyed by player. */
  bet: { limit: 40, periodSeconds: 10 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;
