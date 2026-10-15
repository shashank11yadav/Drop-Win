import {
  BetRequest,
  describeIssues,
  type ErrorCode,
  HistoryQuery,
  IdempotencyKey,
  RotateSeedRequest,
} from '@drop-win/contract';
import {
  LEDGER_ERRORS,
  Ledger,
  type LedgerOptions,
  type LedgerResult,
  type MemoryChanges,
  MemoryStore,
  restoreStore,
} from '@drop-win/ledger';
import { HouseRequest, type HouseMessage, type PortLike } from './protocol.ts';

/** Browser mode has exactly one player: whoever has this tab open. */
export const PLAYER_ID = 'local';

/** Where the house keeps its ledger between visits. */
export interface HouseStorage {
  /** The saved records, or null when nothing has been saved yet. */
  load(): Promise<unknown>;
  save(changes: MemoryChanges): Promise<void>;
  clear(): Promise<void>;
}

export interface HouseOptions {
  /** Null when the browser offers no storage; the demo then lasts as long as the tab. */
  storage: HouseStorage | null;
  ledger?: LedgerOptions;
}

export const NOTICES = {
  rejected: 'Saved demo data failed its checks, so a fresh demo was started.',
  unavailable:
    'This browser is not letting the demo save, so progress from here on is lost when the tab closes.',
} as const;

class HouseFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function unwrap<T>(result: LedgerResult<T>): T {
  if (result.ok) return result.value;
  const { status, code, message } = LEDGER_ERRORS[result.error];
  throw new HouseFailure(status, code, message);
}

function badRequest(message: string): HouseFailure {
  return new HouseFailure(400, 'bad_request', message);
}

/**
 * The house for browser mode: the shared ledger on an in-memory store, saved
 * to storage after every committed transaction. It runs in a Web Worker so
 * the active server seed lives in a separate JavaScript context from the UI.
 * That keeps honest code honest; it is not a security boundary against the
 * person who owns the browser.
 */
export class House {
  readonly #storageOption: HouseStorage | null;
  readonly #ledgerOptions: LedgerOptions;
  readonly #listeners = new Set<(message: string) => void>();
  #storage: HouseStorage | null;
  #ledger: Ledger | null = null;
  // Requests run one at a time so a reset can never interleave with a bet.
  #queue: Promise<unknown> = Promise.resolve();
  #saves: Promise<void> = Promise.resolve();
  // Saves queued by a store that a reset has since replaced are dropped.
  #generation = 0;

  constructor(options: HouseOptions) {
    this.#storageOption = options.storage;
    this.#storage = options.storage;
    this.#ledgerOptions = options.ledger ?? {};
  }

  onNotice(listener: (message: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Answers one message from the page, or returns null for one with no usable id. */
  handle(message: unknown): Promise<HouseMessage | null> {
    const parsed = HouseRequest.safeParse(message);
    if (!parsed.success) {
      const id: unknown = (message as { id?: unknown } | null)?.id;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id,
        ok: false,
        failure: { status: 400, error: 'bad_request', message: 'Unknown request.' },
      });
    }
    const request = parsed.data;
    const run = this.#queue.then(() => this.#answer(request));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #answer(request: HouseRequest): Promise<HouseMessage> {
    try {
      const value = await this.#perform(request);
      // Reply only once the result is saved, as a server would after its commit.
      await this.#saves;
      return { id: request.id, ok: true, value };
    } catch (error) {
      if (error instanceof HouseFailure) {
        return {
          id: request.id,
          ok: false,
          failure: { status: error.status, error: error.code, message: error.message },
        };
      }
      return {
        id: request.id,
        ok: false,
        failure: { status: 500, error: 'internal', message: 'Something went wrong.' },
      };
    }
  }

  async #perform(request: HouseRequest): Promise<unknown> {
    if (request.op === 'reset') return this.#reset();
    const ledger = await this.#open();
    switch (request.op) {
      case 'session':
      case 'state': {
        const state = await ledger.state(PLAYER_ID);
        if (!state) return unwrap({ ok: false, error: 'not_found' });
        return state;
      }
      case 'history': {
        const query = HistoryQuery.safeParse(
          request.before === undefined ? {} : { before: request.before },
        );
        if (!query.success) throw badRequest(describeIssues(query.error));
        const before = query.data.before === undefined ? undefined : Number(query.data.before);
        return ledger.history(PLAYER_ID, before);
      }
      case 'bet': {
        const key = IdempotencyKey.safeParse(request.idempotencyKey);
        if (!key.success) throw badRequest('Idempotency key must be a UUID.');
        const bet = BetRequest.safeParse(request.request);
        if (!bet.success) throw badRequest(describeIssues(bet.error));
        return unwrap(await ledger.bet(PLAYER_ID, bet.data, key.data));
      }
      case 'rotateSeed': {
        const body = RotateSeedRequest.safeParse({ clientSeed: request.clientSeed });
        if (!body.success) throw badRequest(describeIssues(body.error));
        return unwrap(await ledger.rotateSeed(PLAYER_ID, body.data.clientSeed));
      }
      case 'refill':
        return unwrap(await ledger.refill(PLAYER_ID));
    }
  }

  async #open(): Promise<Ledger> {
    if (this.#ledger) return this.#ledger;
    const store = (await this.#restore()) ?? this.#freshStore();
    const ledger = new Ledger(store, this.#ledgerOptions);
    if (!store.player(PLAYER_ID)) await ledger.create(PLAYER_ID);
    this.#ledger = ledger;
    return ledger;
  }

  async #restore(): Promise<MemoryStore | null> {
    const storage = this.#storage;
    if (!storage) return null;
    let saved: unknown;
    try {
      saved = await storage.load();
    } catch {
      this.#storageFailed();
      return null;
    }
    if (saved === null) return null;
    try {
      const store = await restoreStore(saved, { onCommit: this.#saver() });
      const players = store.dump().players;
      if (players.length !== 1 || players[0]?.id !== PLAYER_ID) throw new Error('foreign player');
      return store;
    } catch {
      this.#notify(NOTICES.rejected);
      await this.#clear();
      return null;
    }
  }

  async #reset(): Promise<unknown> {
    this.#generation += 1;
    this.#ledger = null;
    // Storage gets another chance after a reset, in case the problem was transient.
    this.#storage = this.#storageOption;
    await this.#saves;
    await this.#clear();
    const ledger = await this.#open();
    return ledger.state(PLAYER_ID);
  }

  #freshStore(): MemoryStore {
    return new MemoryStore({ onCommit: this.#saver() });
  }

  #saver(): (changes: MemoryChanges) => void {
    const generation = this.#generation;
    return (changes) => {
      this.#saves = this.#saves.then(async () => {
        const storage = this.#storage;
        if (!storage || generation !== this.#generation) return;
        try {
          await storage.save(changes);
        } catch {
          this.#storageFailed();
        }
      });
    };
  }

  async #clear(): Promise<void> {
    const storage = this.#storage;
    if (!storage) return;
    try {
      await storage.clear();
    } catch {
      this.#storageFailed();
    }
  }

  #storageFailed(): void {
    if (!this.#storage) return;
    this.#storage = null;
    this.#notify(NOTICES.unavailable);
  }

  #notify(message: string): void {
    for (const listener of this.#listeners) listener(message);
  }
}

/**
 * Connects a house to the page through a worker scope or a MessagePort. The
 * listener is attached at once and requests wait for the house, because a
 * worker drops messages that arrive before it has a listener.
 */
export function serveHouse(port: PortLike, house: House | Promise<House>): void {
  const ready = Promise.resolve(house).then((h) => {
    h.onNotice((notice) => {
      port.postMessage({ notice });
    });
    return h;
  });
  port.addEventListener('message', (event) => {
    void ready
      .then((h) => h.handle(event.data))
      .then((reply) => {
        if (reply) port.postMessage(reply);
      });
  });
}
