import { ERROR_CODES } from '@drop-win/contract';
import * as z from 'zod/mini';

/**
 * Messages between the page and the house worker. The house validates every
 * request field with the same contract schemas as the HTTP API, and the page
 * parses every result with the same response schemas, so neither side trusts
 * the other to be well formed.
 */

const id = z.int().check(z.gte(0));

export const HouseRequest = z.discriminatedUnion('op', [
  z.strictObject({ id, op: z.literal('session') }),
  z.strictObject({ id, op: z.literal('state') }),
  z.strictObject({ id, op: z.literal('history'), before: z.optional(z.unknown()) }),
  z.strictObject({
    id,
    op: z.literal('bet'),
    request: z.unknown(),
    idempotencyKey: z.unknown(),
  }),
  z.strictObject({ id, op: z.literal('rotateSeed'), clientSeed: z.unknown() }),
  z.strictObject({ id, op: z.literal('refill') }),
  z.strictObject({ id, op: z.literal('reset') }),
]);
export type HouseRequest = z.infer<typeof HouseRequest>;

export type HouseOp = HouseRequest['op'];

const HouseFailure = z.object({
  status: z.int(),
  error: z.enum(ERROR_CODES),
  message: z.string(),
});
export type HouseFailure = z.infer<typeof HouseFailure>;

export const HouseMessage = z.union([
  z.object({ id, ok: z.literal(true), value: z.unknown() }),
  z.object({ id, ok: z.literal(false), failure: HouseFailure }),
  z.object({ notice: z.string() }),
]);
export type HouseMessage = z.infer<typeof HouseMessage>;

/**
 * The part of MessagePort, Worker and a worker's global scope that both ends
 * use, so tests can connect the two with a plain MessageChannel.
 */
export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
