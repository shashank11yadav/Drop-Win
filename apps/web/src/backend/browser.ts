import {
  BetPage,
  BetReceipt,
  type BetRequest,
  PlayerState,
  SeedRotation,
} from '@drop-win/contract';
import { type HouseOp, HouseMessage, type PortLike } from '../house/protocol.ts';
import { type GameBackend, GameError } from './types.ts';

interface Parser<T> {
  parse(value: unknown): T;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: GameError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 15_000;
const STOPPED = 'The in-browser house stopped responding. Reload the page.';

/**
 * The house in a Web Worker in this tab. Every result is parsed with the same
 * schemas as API responses, and errors arrive with the API's codes and
 * messages, so the UI behaves the same in both modes.
 */
export class BrowserBackend implements GameBackend {
  readonly mode = 'browser';
  readonly #port: PortLike;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(message: string) => void>();
  // Notices sent before the UI subscribes (a rejected save, say) are kept for it.
  readonly #unseen: string[] = [];
  #nextId = 0;

  constructor(port: PortLike) {
    this.#port = port;
    port.addEventListener('message', (event) => {
      this.#receive(event.data);
    });
  }

  session(): Promise<PlayerState> {
    return this.#call({ op: 'session' }, PlayerState);
  }

  state(): Promise<PlayerState> {
    return this.#call({ op: 'state' }, PlayerState);
  }

  history(before?: string): Promise<BetPage> {
    return this.#call(
      before === undefined ? { op: 'history' } : { op: 'history', before },
      BetPage,
    );
  }

  bet(request: BetRequest, idempotencyKey: string): Promise<BetReceipt> {
    return this.#call({ op: 'bet', request, idempotencyKey }, BetReceipt);
  }

  rotateSeed(clientSeed: string): Promise<SeedRotation> {
    return this.#call({ op: 'rotateSeed', clientSeed }, SeedRotation);
  }

  refill(): Promise<PlayerState> {
    return this.#call({ op: 'refill' }, PlayerState);
  }

  reset(): Promise<PlayerState> {
    return this.#call({ op: 'reset' }, PlayerState);
  }

  onNotice(listener: (message: string) => void): () => void {
    this.#listeners.add(listener);
    for (const message of this.#unseen.splice(0)) listener(message);
    return () => this.#listeners.delete(listener);
  }

  /** Fails every waiting call, for when the worker itself errors. */
  fail(message: string = STOPPED): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.reject(new GameError(0, 'network', message));
    }
  }

  #call<T>(message: { op: HouseOp } & Record<string, unknown>, schema: Parser<T>): Promise<T> {
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new GameError(0, 'network', STOPPED));
      }, TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#port.postMessage({ ...message, id });
    }).then((value) => {
      try {
        return schema.parse(value);
      } catch {
        throw new GameError(500, 'internal', 'Unexpected response from the house.');
      }
    });
  }

  #receive(data: unknown): void {
    const parsed = HouseMessage.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    if ('notice' in message) {
      if (this.#listeners.size === 0) this.#unseen.push(message.notice);
      for (const listener of this.#listeners) listener(message.notice);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.value);
    else {
      const { status, error, message: text } = message.failure;
      pending.reject(new GameError(status, error, text));
    }
  }
}
