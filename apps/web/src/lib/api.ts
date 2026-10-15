import {
  BetPage,
  BetReceipt,
  type BetRequest,
  type ErrorCode,
  ErrorBody,
  PlayerState,
  SeedRotation,
} from '@drop-win/contract';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network';

  constructor(status: number, code: ErrorCode | 'network', message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface Parser<T> {
  parse(value: unknown): T;
}

interface CallInit {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

async function call<T>(path: string, schema: Parser<T>, init: CallInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    if (parsed.success) throw new ApiError(response.status, parsed.data.error, parsed.data.message);
    throw new ApiError(
      response.status,
      'internal',
      `Unexpected response (${String(response.status)}).`,
    );
  }
  // The server is trusted to be honest about outcomes (that is what the
  // verifier is for), but not to be well formed.
  return schema.parse(body);
}

const post = (body: unknown, headers: Record<string, string> = {}): CallInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers,
});

export const api = {
  session: () => call('/api/session', PlayerState, post({})),
  state: () => call('/api/state', PlayerState),
  history: (before?: string) =>
    call(`/api/bets${before ? `?before=${encodeURIComponent(before)}` : ''}`, BetPage),
  rotateSeed: (clientSeed: string) => call('/api/seeds/rotate', SeedRotation, post({ clientSeed })),
  refill: () => call('/api/balance/refill', PlayerState, post({})),

  /**
   * Places a bet. A dropped connection or a busy server is retried once with
   * the same idempotency key, so the bet is charged at most once.
   */
  async bet(request: BetRequest): Promise<BetReceipt> {
    const init = post(request, { 'Idempotency-Key': crypto.randomUUID() });
    try {
      return await call('/api/bets', BetReceipt, init);
    } catch (error) {
      const retryable =
        error instanceof ApiError && (error.code === 'network' || error.code === 'busy');
      if (!retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return call('/api/bets', BetReceipt, init);
    }
  },
};
