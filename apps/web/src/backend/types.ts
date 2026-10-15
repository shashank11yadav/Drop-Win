import type {
  BetPage,
  BetReceipt,
  BetRequest,
  ErrorCode,
  PlayerState,
  SeedRotation,
} from '@drop-win/contract';

export class GameError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network';

  constructor(status: number, code: ErrorCode | 'network', message: string) {
    super(message);
    this.name = 'GameError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Where the house runs. The UI only talks to this interface; HttpBackend
 * calls the API, BrowserBackend calls a Web Worker in the same tab. Both
 * throw GameError with the same codes and messages.
 */
export interface GameBackend {
  readonly mode: 'server' | 'browser';
  /** Starts a player or resumes the existing one. */
  session(): Promise<PlayerState>;
  state(): Promise<PlayerState>;
  history(before?: string): Promise<BetPage>;
  /** One attempt. Use placeBet, which adds the key and the retry. */
  bet(request: BetRequest, idempotencyKey: string): Promise<BetReceipt>;
  rotateSeed(clientSeed: string): Promise<SeedRotation>;
  refill(): Promise<PlayerState>;
  /** Browser mode only: wipes the saved demo and starts over. */
  reset?(): Promise<PlayerState>;
  /** Browser mode only: messages the house wants shown, such as a storage problem. */
  onNotice?(listener: (message: string) => void): () => void;
}

const RETRY_DELAY_MS = 400;

/**
 * Places a bet. A dropped connection or a busy house is retried once with
 * the same idempotency key, so the bet is charged at most once.
 */
export async function placeBet(backend: GameBackend, request: BetRequest): Promise<BetReceipt> {
  const key = crypto.randomUUID();
  try {
    return await backend.bet(request, key);
  } catch (error) {
    const retryable =
      error instanceof GameError && (error.code === 'network' || error.code === 'busy');
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return backend.bet(request, key);
  }
}
