import { CLIENT_SEED_PATTERN } from '@drop-win/contract';
import {
  formatMultiplier,
  isRisk,
  isRowCount,
  multiplierTable,
  pathFromDigest,
  resultFromDigest,
  RISKS,
  ROW_COUNTS,
  roundMessage,
  type Risk,
  type RoundResult,
  type RowCount,
  sha256Hex,
  hmacSha256,
} from '@drop-win/fairness';
import { useEffect, useId, useMemo, useState } from 'react';
import { Board, type Flight } from '../board/Board.tsx';
import { parseVerifyParams, type VerifyFields } from '../lib/route.ts';
import { usePrefersReducedMotion } from '../lib/use-media-query.ts';

interface FormValues {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: string;
  rows: string;
  risk: string;
}

interface Outcome {
  rows: RowCount;
  risk: Risk;
  result: RoundResult;
  bits: string;
  hashOfSeed: string;
  inputs: { serverSeed: string; message: string };
}

function toForm(fields: Partial<VerifyFields>): FormValues {
  return {
    serverSeed: fields.serverSeed ?? '',
    serverSeedHash: fields.serverSeedHash ?? '',
    clientSeed: fields.clientSeed ?? '',
    nonce: fields.nonce === undefined ? '' : String(fields.nonce),
    rows: String(fields.rows ?? 16),
    risk: fields.risk ?? 'medium',
  };
}

function validate(values: FormValues): string | null {
  if (!/^[0-9a-f]{64}$/.test(values.serverSeed))
    return 'Server seed must be 64 lowercase hex characters.';
  if (values.serverSeedHash && !/^[0-9a-f]{64}$/.test(values.serverSeedHash)) {
    return 'Server seed hash must be 64 lowercase hex characters.';
  }
  if (!CLIENT_SEED_PATTERN.test(values.clientSeed))
    return 'Client seed must be 1 to 64 letters, digits, - or _.';
  if (!/^\d{1,15}$/.test(values.nonce)) return 'Nonce must be a whole number.';
  if (!isRowCount(Number(values.rows))) return 'Rows must be between 8 and 16.';
  if (!isRisk(values.risk)) return 'Risk must be low, medium or high.';
  return null;
}

/**
 * Recomputes a round with the browser's own Web Crypto. Nothing is sent to
 * the server; this page would work offline.
 */
async function recompute(values: FormValues): Promise<Outcome> {
  const rows = Number(values.rows);
  if (!isRowCount(rows) || !isRisk(values.risk)) throw new Error('invalid form');
  const message = roundMessage(values.clientSeed, Number(values.nonce));
  const digest = await hmacSha256(values.serverSeed, message);
  return {
    rows,
    risk: values.risk,
    result: resultFromDigest(digest, rows, values.risk),
    bits: pathFromDigest(digest, rows).replaceAll('L', '0').replaceAll('R', '1'),
    hashOfSeed: await sha256Hex(values.serverSeed),
    inputs: { serverSeed: values.serverSeed, message },
  };
}

const NO_FLIGHTS: Flight[] = [];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function VerifyPage({ query }: { query: string }) {
  const id = useId();
  const parsed = useMemo(() => parseVerifyParams(new URLSearchParams(query)), [query]);
  const [values, setValues] = useState<FormValues>(() => toForm(parsed.fields));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  // A complete link (from the history table) is verified straight away. The
  // page is keyed by the query string, so a new link starts from scratch.
  useEffect(() => {
    const initial = toForm(parsed.fields);
    if (validate(initial) === null) void recompute(initial).then(setOutcome);
  }, [parsed]);

  const expected = parsed.fields;
  const field = (name: keyof FormValues) => ({
    id: `${id}-${name}`,
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      setValues((v) => ({ ...v, [name]: event.target.value.trim() }));
    },
  });

  const hashMatches =
    outcome && values.serverSeedHash ? outcome.hashOfSeed === values.serverSeedHash : null;
  const pathMatches =
    outcome &&
    expected.expectedPath !== undefined &&
    outcome.inputs.serverSeed === values.serverSeed
      ? outcome.result.path === expected.expectedPath &&
        (expected.expectedMultiplier === undefined ||
          outcome.result.multiplierHundredths === expected.expectedMultiplier)
      : null;

  return (
    <main className="verify">
      <section className="panel" aria-labelledby="verify-heading">
        <h1 id="verify-heading">Verify a round</h1>
        <p className="hint">
          Paste the revealed server seed, your client seed and the nonce. The result is recomputed
          here with Web Crypto: HMAC-SHA256(server seed, client seed:nonce), one bit per row, 1 for
          right.
        </p>
        {parsed.rejected.length > 0 && (
          <p className="hint error" role="alert">
            Ignored invalid link fields: {parsed.rejected.join(', ')}.
          </p>
        )}
        {!parsed.fields.serverSeed && parsed.fields.serverSeedHash && (
          <p className="hint" role="note">
            This bet's server seed is still secret. Rotate your seeds on the Play page, then open
            the link again from the history.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validate(values);
            setError(problem);
            if (problem) {
              setOutcome(null);
              return;
            }
            void recompute(values).then(setOutcome);
          }}
        >
          <div className="verify-grid">
            <div className="field wide">
              <label htmlFor={`${id}-serverSeed`}>Server seed (revealed)</label>
              <input type="text" spellCheck={false} autoComplete="off" {...field('serverSeed')} />
            </div>
            <div className="field wide">
              <label htmlFor={`${id}-serverSeedHash`}>Server seed hash (committed)</label>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                {...field('serverSeedHash')}
              />
            </div>
            <div className="field wide">
              <label htmlFor={`${id}-clientSeed`}>Client seed</label>
              <input type="text" spellCheck={false} autoComplete="off" {...field('clientSeed')} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-nonce`}>Nonce</label>
              <input type="text" inputMode="numeric" autoComplete="off" {...field('nonce')} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-rows`}>Rows</label>
              <select {...field('rows')}>
                {ROW_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field wide">
              <label htmlFor={`${id}-risk`}>Risk</label>
              <select {...field('risk')}>
                {RISKS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="button primary" type="submit">
            Verify
          </button>
          {error && (
            <p className="hint error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section className="panel" aria-labelledby="result-heading" aria-live="polite">
        <h2 id="result-heading">Result</h2>
        {!outcome ? (
          <p className="empty">Fill in the form to see the path and bucket.</p>
        ) : (
          <>
            {hashMatches !== null && (
              <p className="status-line" data-testid="hash-check">
                <strong className={hashMatches ? 'win' : 'loss'}>
                  {hashMatches ? 'Pass' : 'Fail'}
                </strong>
                <span>
                  {hashMatches
                    ? 'SHA-256 of the server seed equals the hash committed before the bet.'
                    : 'SHA-256 of the server seed does not match the committed hash.'}
                </span>
              </p>
            )}
            {pathMatches !== null && (
              <p className="status-line" data-testid="result-check">
                <strong className={pathMatches ? 'win' : 'loss'}>
                  {pathMatches ? 'Pass' : 'Fail'}
                </strong>
                <span>
                  {pathMatches
                    ? 'The recomputed path and multiplier match what the server paid.'
                    : 'The recomputed result differs from what the server reported.'}
                </span>
              </p>
            )}
            <dl className="kv">
              <div>
                <dt>HMAC-SHA256 digest</dt>
                <dd>
                  <code>{outcome.result.digestHex}</code>
                </dd>
              </div>
              <div>
                <dt>First {outcome.bits.length} bits</dt>
                <dd className="bits">{outcome.bits}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd className="bits" data-testid="verified-path">
                  {outcome.result.path}
                </dd>
              </div>
              <div>
                <dt>Bucket and multiplier</dt>
                <dd data-testid="verified-result">
                  Bucket {outcome.result.bucket},{' '}
                  {formatMultiplier(outcome.result.multiplierHundredths)}
                </dd>
              </div>
            </dl>
            <Board
              rows={outcome.rows}
              table={multiplierTable(outcome.risk, outcome.rows)}
              flights={NO_FLIGHTS}
              reducedMotion={reducedMotion}
              trace={outcome.result.path}
              label={`Path ${outcome.result.path} ending in bucket ${String(outcome.result.bucket)}.`}
            />
            <h3 className="field-label">Check without this site</h3>
            <pre className="command">
              {`printf '%s' ${shellQuote(outcome.inputs.serverSeed)} | shasum -a 256\n`}
              {`printf '%s' ${shellQuote(outcome.inputs.message)} | openssl dgst -sha256 -hmac ${shellQuote(outcome.inputs.serverSeed)}`}
            </pre>
            <p className="hint">
              Read the first {outcome.bits.length} bits of the digest left to right. Each 1 is a
              bounce to the right, and the bucket is the number of 1s.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
