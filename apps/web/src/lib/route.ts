import { ClientSeed, RiskSchema, RowCountSchema } from '@drop-win/contract';
import type { Risk, RowCount } from '@drop-win/fairness';
import { useSyncExternalStore } from 'react';
import * as z from 'zod/mini';

export type Route = { page: 'play' } | { page: 'verify'; query: string };

/** Hash routing keeps the app a static bundle that works on any host. */
export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  if (path === '/verify') return { page: 'verify', query };
  return { page: 'play' };
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  return parseHash(hash);
}

export interface VerifyFields {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  rows: RowCount;
  risk: Risk;
  /** What the server reported, when the link came from the bet history. */
  expectedPath?: string;
  expectedMultiplier?: number;
}

const hex64 = z.string().check(z.regex(/^[0-9a-f]{64}$/));
const wholeNumber = z.pipe(z.string().check(z.regex(/^\d{1,15}$/)), z.transform(Number));

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * Reads verify-link parameters. Each field is validated on its own, so one bad
 * value is reported without throwing away the rest.
 */
export function parseVerifyParams(params: URLSearchParams): {
  fields: Partial<VerifyFields>;
  rejected: string[];
} {
  const fields: Partial<VerifyFields> = {};
  const rejected: string[] = [];
  const take = <T>(name: string, parser: Parser<T>, apply: (value: T) => void) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return;
    const parsed = parser.safeParse(raw);
    if (parsed.success) apply(parsed.data);
    else rejected.push(name);
  };

  take('serverSeed', hex64, (v) => (fields.serverSeed = v));
  take('hash', hex64, (v) => (fields.serverSeedHash = v));
  take('clientSeed', ClientSeed, (v) => (fields.clientSeed = v));
  take('nonce', wholeNumber, (v) => (fields.nonce = v));
  take('rows', z.pipe(wholeNumber, RowCountSchema), (v) => (fields.rows = v));
  take('risk', RiskSchema, (v) => (fields.risk = v));
  take('path', z.string().check(z.regex(/^[LR]{8,16}$/)), (v) => (fields.expectedPath = v));
  take('multiplier', wholeNumber, (v) => (fields.expectedMultiplier = v));
  return { fields, rejected };
}

export function verifyHash(fields: Partial<VerifyFields>): string {
  const params = new URLSearchParams();
  if (fields.serverSeed) params.set('serverSeed', fields.serverSeed);
  if (fields.serverSeedHash) params.set('hash', fields.serverSeedHash);
  if (fields.clientSeed) params.set('clientSeed', fields.clientSeed);
  if (fields.nonce !== undefined) params.set('nonce', String(fields.nonce));
  if (fields.rows !== undefined) params.set('rows', String(fields.rows));
  if (fields.risk) params.set('risk', fields.risk);
  if (fields.expectedPath) params.set('path', fields.expectedPath);
  if (fields.expectedMultiplier !== undefined) {
    params.set('multiplier', String(fields.expectedMultiplier));
  }
  return `#/verify?${params.toString()}`;
}
