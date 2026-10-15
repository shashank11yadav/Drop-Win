import {
  CLIENT_SEED_PATTERN,
  MAX_BET_CENTS,
  MIN_BET_CENTS,
  RiskSchema,
  RowCountSchema,
} from '@drop-win/contract';
import { sha256Hex } from '@drop-win/fairness';
import * as z from 'zod/mini';
import { type MemoryChanges, type MemoryDump, MemoryStore } from './memory-store.ts';

const cents = z.int().check(z.gte(0));
const id = z.int().check(z.gte(1));
const time = z.int().check(z.gte(0));
const hex64 = z.string().check(z.regex(/^[0-9a-f]{64}$/));

const PlayerRecord = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(64)),
  balanceCents: cents,
  createdAt: time,
});

const SeedRecord = z.strictObject({
  id,
  playerId: z.string(),
  serverSeed: hex64,
  serverSeedHash: hex64,
  clientSeed: z.string().check(z.regex(CLIENT_SEED_PATTERN)),
  nextNonce: cents,
  createdAt: time,
  revealedAt: z.nullable(time),
});

const BetRecord = z.strictObject({
  id,
  playerId: z.string(),
  seedId: id,
  nonce: cents,
  idempotencyKey: z.uuid(),
  amountCents: z.int().check(z.gte(MIN_BET_CENTS), z.lte(MAX_BET_CENTS)),
  rows: RowCountSchema,
  risk: RiskSchema,
  path: z.string().check(z.regex(/^[LR]{8,16}$/)),
  bucket: cents,
  multiplierHundredths: cents,
  payoutCents: cents,
  balanceAfterCents: cents,
  createdAt: time,
});

const Dump = z.strictObject({
  players: z.array(PlayerRecord),
  seeds: z.array(SeedRecord),
  bets: z.array(BetRecord),
});

export class InvalidDumpError extends Error {
  constructor(reason: string) {
    super(`saved ledger rejected: ${reason}`);
    this.name = 'InvalidDumpError';
  }
}

/**
 * Turns untrusted saved data (from IndexedDB, which the page, extensions and
 * devtools can all write) back into a store, or throws InvalidDumpError.
 * Shape, ranges, cross-record constraints and every seed commitment are
 * checked, so a hand-edited save cannot claim a hash its seed does not match.
 */
export async function restoreStore(
  data: unknown,
  options: { onCommit?: (changes: MemoryChanges) => void } = {},
): Promise<MemoryStore> {
  const parsed = Dump.safeParse(data);
  if (!parsed.success) throw new InvalidDumpError('unexpected shape');
  const dump: MemoryDump = parsed.data;
  for (const seed of dump.seeds) {
    if ((await sha256Hex(seed.serverSeed)) !== seed.serverSeedHash) {
      throw new InvalidDumpError(`seed ${String(seed.id)} does not match its commitment`);
    }
  }
  for (const bet of dump.bets) {
    if (bet.path.length !== bet.rows || bet.bucket !== bet.path.split('R').length - 1) {
      throw new InvalidDumpError(`bet ${String(bet.id)} has an inconsistent path`);
    }
  }
  try {
    return MemoryStore.fromDump(dump, options);
  } catch (error) {
    throw new InvalidDumpError(error instanceof Error ? error.message : 'constraint failed');
  }
}
