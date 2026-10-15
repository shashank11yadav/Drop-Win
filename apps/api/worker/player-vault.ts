import type { BetRequest } from '@drop-win/contract';
import { Ledger } from '@drop-win/ledger';
import { DurableObject } from 'cloudflare:workers';
import { SqlStore } from '../src/sql-store.ts';
import { durableObjectSql } from './do-sql.ts';
import type { WorkerEnv } from './env.ts';

/**
 * One instance per player, addressed by player id. Cloudflare runs at most one
 * copy of an object at a time, so the ledger's in-memory queue serializes all
 * of that player's bets, and its SQLite storage makes each bet atomic.
 */
export class PlayerVault extends DurableObject<WorkerEnv> {
  readonly #ledger: Ledger;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.#ledger = new Ledger(new SqlStore(durableObjectSql(ctx.storage)));
  }

  create(playerId: string) {
    return this.#ledger.create(playerId);
  }

  state(playerId: string) {
    return this.#ledger.state(playerId);
  }

  bet(playerId: string, request: BetRequest, idempotencyKey: string) {
    return this.#ledger.bet(playerId, request, idempotencyKey);
  }

  rotateSeed(playerId: string, clientSeed: string) {
    return this.#ledger.rotateSeed(playerId, clientSeed);
  }

  history(playerId: string, before?: number) {
    return this.#ledger.history(playerId, before);
  }

  refill(playerId: string) {
    return this.#ledger.refill(playerId);
  }
}
