import { RISKS, ROW_COUNTS } from '@drop-win/fairness';
import * as z from 'zod/mini';
import { CLIENT_SEED_PATTERN, MAX_BET_CENTS, MIN_BET_CENTS } from './limits.ts';

const cents = z.int().check(z.gte(0));
const hex64 = z.string().check(z.regex(/^[0-9a-f]{64}$/));

export const ClientSeed = z.string().check(z.regex(CLIENT_SEED_PATTERN));
export const RowCountSchema = z.literal(ROW_COUNTS);
export const RiskSchema = z.enum(RISKS);
export const IdempotencyKey = z.uuid();

// Requests: strict objects, so unexpected fields are an error rather than ignored.

export const BetRequest = z.strictObject({
  amountCents: z.int().check(z.gte(MIN_BET_CENTS), z.lte(MAX_BET_CENTS)),
  rows: RowCountSchema,
  risk: RiskSchema,
});
export type BetRequest = z.infer<typeof BetRequest>;

export const RotateSeedRequest = z.strictObject({ clientSeed: ClientSeed });
export type RotateSeedRequest = z.infer<typeof RotateSeedRequest>;

export const HistoryQuery = z.strictObject({
  before: z.optional(z.string().check(z.regex(/^[1-9][0-9]{0,15}$/))),
});

// Responses: parsed by the web client before use.

export const SeedCommitment = z.object({
  serverSeedHash: hex64,
  clientSeed: ClientSeed,
  nonce: cents,
});
export type SeedCommitment = z.infer<typeof SeedCommitment>;

export const PlayerState = z.object({
  balanceCents: cents,
  seed: SeedCommitment,
  canRefill: z.boolean(),
});
export type PlayerState = z.infer<typeof PlayerState>;

export const Bet = z.object({
  id: z.int().check(z.gte(1)),
  createdAt: z.int(),
  amountCents: cents,
  rows: RowCountSchema,
  risk: RiskSchema,
  nonce: cents,
  path: z.string().check(z.regex(/^[LR]{8,16}$/)),
  bucket: cents,
  multiplierHundredths: cents,
  payoutCents: cents,
  balanceAfterCents: cents,
  clientSeed: ClientSeed,
  serverSeedHash: hex64,
  /** Null until the seed is rotated; the server never sends an active seed. */
  serverSeed: z.nullable(hex64),
});
export type Bet = z.infer<typeof Bet>;

export const BetReceipt = z.object({ bet: Bet, state: PlayerState, replayed: z.boolean() });
export type BetReceipt = z.infer<typeof BetReceipt>;

export const BetPage = z.object({ bets: z.array(Bet), nextBefore: z.nullable(z.string()) });
export type BetPage = z.infer<typeof BetPage>;

export const RevealedSeed = z.object({
  serverSeed: hex64,
  serverSeedHash: hex64,
  clientSeed: ClientSeed,
  /** Number of bets played on this seed pair, so nonces 0 .. betCount - 1. */
  betCount: cents,
  revealedAt: z.int(),
});
export type RevealedSeed = z.infer<typeof RevealedSeed>;

export const SeedRotation = z.object({ revealed: RevealedSeed, state: PlayerState });
export type SeedRotation = z.infer<typeof SeedRotation>;

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'not_found',
  'insufficient_funds',
  'idempotency_conflict',
  'refill_not_allowed',
  'rate_limited',
  'unsupported_media_type',
  'payload_too_large',
  'forbidden_origin',
  'busy',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorBody = z.object({ error: z.enum(ERROR_CODES), message: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;
