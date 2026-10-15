import type {
  BetRecord,
  BetView,
  LedgerStore,
  NewBet,
  NewSeed,
  PlayerRecord,
  SeedRecord,
} from './store.ts';

/** Everything a MemoryStore holds, as plain data that can be saved and restored. */
export interface MemoryDump {
  players: PlayerRecord[];
  seeds: SeedRecord[];
  bets: BetRecord[];
}

/** Records written by one committed transaction, for incremental persistence. */
export interface MemoryChanges {
  players: PlayerRecord[];
  seeds: SeedRecord[];
  bets: BetRecord[];
}

export class ConstraintError extends Error {
  constructor(message: string) {
    super(`constraint failed: ${message}`);
    this.name = 'ConstraintError';
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new ConstraintError(message);
}

function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * A LedgerStore in plain objects, for the browser house. It enforces the same
 * CHECK and UNIQUE rules as the SQLite schema, and a failed transaction is
 * rolled back with an undo log so the ledger sees all of a bet or none of it.
 */
export class MemoryStore implements LedgerStore {
  readonly #players = new Map<string, PlayerRecord>();
  readonly #seeds = new Map<number, SeedRecord>();
  readonly #bets: BetRecord[] = [];
  readonly #betKeys = new Map<string, BetRecord>();
  readonly #betNonces = new Set<string>();
  #nextSeedId = 1;
  #nextBetId = 1;

  #undo: (() => void)[] | null = null;
  #changed: { players: Set<string>; seeds: Set<number>; bets: BetRecord[] } | null = null;
  readonly #onCommit: ((changes: MemoryChanges) => void) | undefined;

  constructor(options: { onCommit?: (changes: MemoryChanges) => void } = {}) {
    this.#onCommit = options.onCommit;
  }

  /**
   * Rebuilds a store from saved records. Every record goes through the normal
   * insert path, so a dump that breaks a constraint throws instead of loading.
   * Callers must validate the shape first (see parseDump).
   */
  static fromDump(
    dump: MemoryDump,
    options: { onCommit?: (changes: MemoryChanges) => void } = {},
  ): MemoryStore {
    // Loading writes records directly, not through transaction(), so nothing
    // is re-saved through onCommit.
    const store = new MemoryStore(options);
    for (const player of dump.players) store.#putPlayer({ ...player });
    const seeds = [...dump.seeds].sort((a, b) => a.id - b.id);
    for (const seed of seeds) {
      check(!store.#seeds.has(seed.id), 'seed ids are unique');
      check(store.#players.has(seed.playerId), 'seed belongs to a player');
      check(
        seed.revealedAt !== null || !store.#activeSeedRecord(seed.playerId),
        'one unrevealed seed per player',
      );
      check(isCents(seed.nextNonce), 'next_nonce >= 0');
      store.#seeds.set(seed.id, { ...seed });
      store.#nextSeedId = Math.max(store.#nextSeedId, seed.id + 1);
    }
    for (const player of store.#players.values()) {
      check(store.#activeSeedRecord(player.id) !== undefined, 'every player has an active seed');
    }
    const bets = [...dump.bets].sort((a, b) => a.id - b.id);
    for (const bet of bets) {
      check(bet.id >= store.#nextBetId, 'bet ids are unique');
      const seed = store.#seeds.get(bet.seedId);
      check(seed?.playerId === bet.playerId, 'bet belongs to its seed player');
      check(seed !== undefined && bet.nonce < seed.nextNonce, 'bet nonce was issued by its seed');
      store.#putBet({ ...bet });
      store.#nextBetId = bet.id + 1;
    }
    return store;
  }

  dump(): MemoryDump {
    return {
      players: [...this.#players.values()].map((p) => ({ ...p })),
      seeds: [...this.#seeds.values()].map((s) => ({ ...s })),
      bets: this.#bets.map((b) => ({ ...b })),
    };
  }

  transaction<T>(fn: () => T): T {
    if (this.#undo) return fn();
    const undo: (() => void)[] = [];
    const changed = {
      players: new Set<string>(),
      seeds: new Set<number>(),
      bets: [] as BetRecord[],
    };
    this.#undo = undo;
    this.#changed = changed;
    try {
      const result = fn();
      this.#undo = null;
      this.#changed = null;
      if (
        this.#onCommit &&
        (changed.players.size > 0 || changed.seeds.size > 0 || changed.bets.length > 0)
      ) {
        this.#onCommit({
          players: [...changed.players].flatMap((id) => {
            const player = this.#players.get(id);
            return player ? [{ ...player }] : [];
          }),
          seeds: [...changed.seeds].flatMap((id) => {
            const seed = this.#seeds.get(id);
            return seed ? [{ ...seed }] : [];
          }),
          bets: changed.bets.map((b) => ({ ...b })),
        });
      }
      return result;
    } catch (error) {
      this.#undo = null;
      this.#changed = null;
      for (const step of undo.reverse()) step();
      throw error;
    }
  }

  player(playerId: string): PlayerRecord | undefined {
    const player = this.#players.get(playerId);
    return player && { ...player };
  }

  insertPlayer(player: PlayerRecord): void {
    this.transaction(() => {
      this.#putPlayer({ ...player });
      this.#undo?.push(() => this.#players.delete(player.id));
      this.#changed?.players.add(player.id);
    });
  }

  setBalance(playerId: string, balanceCents: number): void {
    this.transaction(() => {
      check(isCents(balanceCents), 'balance_cents >= 0');
      const player = this.#players.get(playerId);
      if (!player) return;
      const previous = player.balanceCents;
      player.balanceCents = balanceCents;
      this.#undo?.push(() => (player.balanceCents = previous));
      this.#changed?.players.add(playerId);
    });
  }

  activeSeed(playerId: string): SeedRecord | undefined {
    const seed = this.#activeSeedRecord(playerId);
    return seed && { ...seed };
  }

  insertSeed(seed: NewSeed): void {
    this.transaction(() => {
      check(this.#players.has(seed.playerId), 'seed belongs to a player');
      check(!this.#activeSeedRecord(seed.playerId), 'one unrevealed seed per player');
      const id = this.#nextSeedId++;
      this.#seeds.set(id, { ...seed, id, nextNonce: 0, revealedAt: null });
      this.#undo?.push(() => {
        this.#seeds.delete(id);
        this.#nextSeedId = id;
      });
      this.#changed?.seeds.add(id);
    });
  }

  revealSeed(seedId: number, revealedAt: number): void {
    this.transaction(() => {
      const seed = this.#seeds.get(seedId);
      if (!seed) return;
      const previous = seed.revealedAt;
      seed.revealedAt = revealedAt;
      this.#undo?.push(() => (seed.revealedAt = previous));
      this.#changed?.seeds.add(seedId);
    });
  }

  incrementNonce(seedId: number): void {
    this.transaction(() => {
      const seed = this.#seeds.get(seedId);
      if (!seed) return;
      check(Number.isSafeInteger(seed.nextNonce + 1), 'next_nonce fits');
      seed.nextNonce += 1;
      this.#undo?.push(() => (seed.nextNonce -= 1));
      this.#changed?.seeds.add(seedId);
    });
  }

  insertBet(bet: NewBet): void {
    this.transaction(() => {
      const seed = this.#seeds.get(bet.seedId);
      check(seed?.playerId === bet.playerId, 'bet belongs to its seed player');
      const record: BetRecord = { ...bet, id: this.#nextBetId++ };
      this.#putBet(record);
      this.#undo?.push(() => {
        this.#bets.pop();
        this.#betKeys.delete(betKey(record.playerId, record.idempotencyKey));
        this.#betNonces.delete(betNonce(record.seedId, record.nonce));
        this.#nextBetId = record.id;
      });
      this.#changed?.bets.push(record);
    });
  }

  betByKey(playerId: string, idempotencyKey: string): BetView | undefined {
    const bet = this.#betKeys.get(betKey(playerId, idempotencyKey));
    return bet && this.#view(bet);
  }

  bets(playerId: string, beforeId: number, limit: number): BetView[] {
    const page: BetView[] = [];
    for (let i = this.#bets.length - 1; i >= 0 && page.length < limit; i--) {
      const bet = this.#bets[i];
      if (bet?.playerId === playerId && bet.id < beforeId) page.push(this.#view(bet));
    }
    return page;
  }

  #putPlayer(player: PlayerRecord): void {
    check(!this.#players.has(player.id), 'player ids are unique');
    check(isCents(player.balanceCents), 'balance_cents >= 0');
    this.#players.set(player.id, player);
  }

  // Bets are kept in id order, which is insertion order, so history is a reverse scan.
  #putBet(bet: BetRecord): void {
    check(Number.isSafeInteger(bet.amountCents) && bet.amountCents > 0, 'amount_cents > 0');
    check(isCents(bet.payoutCents), 'payout_cents >= 0');
    check(isCents(bet.balanceAfterCents), 'balance_after_cents >= 0');
    const key = betKey(bet.playerId, bet.idempotencyKey);
    const nonce = betNonce(bet.seedId, bet.nonce);
    check(!this.#betKeys.has(key), 'unique (player_id, idempotency_key)');
    check(!this.#betNonces.has(nonce), 'unique (seed_id, nonce)');
    this.#bets.push(bet);
    this.#betKeys.set(key, bet);
    this.#betNonces.add(nonce);
  }

  #activeSeedRecord(playerId: string): SeedRecord | undefined {
    for (const seed of this.#seeds.values()) {
      if (seed.playerId === playerId && seed.revealedAt === null) return seed;
    }
    return undefined;
  }

  #view(bet: BetRecord): BetView {
    const seed = this.#seeds.get(bet.seedId);
    if (!seed) throw new Error(`bet ${String(bet.id)} has no seed`);
    return {
      ...bet,
      clientSeed: seed.clientSeed,
      serverSeedHash: seed.serverSeedHash,
      serverSeed: seed.serverSeed,
      revealedAt: seed.revealedAt,
    };
  }
}

function betKey(playerId: string, idempotencyKey: string): string {
  return `${playerId}\u0000${idempotencyKey}`;
}

function betNonce(seedId: number, nonce: number): string {
  return `${String(seedId)}:${String(nonce)}`;
}
