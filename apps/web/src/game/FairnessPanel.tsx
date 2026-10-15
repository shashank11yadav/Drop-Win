import type { RevealedSeed, SeedCommitment } from '@drop-win/contract';
import { CLIENT_SEED_PATTERN } from '@drop-win/contract';
import { randomSeedHex } from '@drop-win/fairness';
import { useEffect, useId, useState } from 'react';

interface FairnessPanelProps {
  seed: SeedCommitment;
  revealed: readonly RevealedSeed[];
  busy: boolean;
  onRotate: (clientSeed: string) => Promise<boolean>;
  /** Browser mode only. */
  onReset?: (() => Promise<void>) | undefined;
}

const CONFIRM_MS = 5000;

function ResetDemo({ busy, onReset }: { busy: boolean; onReset: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setConfirming(false);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [confirming]);

  return (
    <div className="demo-reset">
      <p className="hint">
        This demo is saved in your browser. Resetting deletes its history and seeds and starts over
        with fresh ones.
      </p>
      <button
        className="button small"
        type="button"
        disabled={busy || resetting}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setConfirming(false);
          setResetting(true);
          void onReset().finally(() => {
            setResetting(false);
          });
        }}
      >
        {confirming ? 'Click again to reset' : 'Reset demo'}
      </button>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button small"
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function FairnessPanel({ seed, revealed, busy, onRotate, onReset }: FairnessPanelProps) {
  const id = useId();
  const [clientSeed, setClientSeed] = useState(() => randomSeedHex(8));
  const [rotating, setRotating] = useState(false);
  const valid = CLIENT_SEED_PATTERN.test(clientSeed);
  const latest = revealed[0];

  return (
    <>
      <h2 id="fairness-heading">Provably fair</h2>
      <p className="hint">
        The house committed to its server seed before your first bet by showing you its SHA-256
        hash. Rotating reveals the seed so every bet made with it can be checked.
      </p>
      <dl className="kv">
        <div>
          <dt>Server seed hash</dt>
          <dd>
            <code data-testid="server-seed-hash">{seed.serverSeedHash}</code>
            <CopyButton text={seed.serverSeedHash} label="Copy server seed hash" />
          </dd>
        </div>
        <div>
          <dt>Client seed</dt>
          <dd>
            <code>{seed.clientSeed}</code>
          </dd>
        </div>
        <div>
          <dt>Next nonce</dt>
          <dd>{seed.nonce}</dd>
        </div>
      </dl>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || busy || rotating) return;
          setRotating(true);
          void onRotate(clientSeed).then((ok) => {
            setRotating(false);
            if (ok) setClientSeed(randomSeedHex(8));
          });
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-client-seed`}>Next client seed</label>
          <input
            id={`${id}-client-seed`}
            type="text"
            value={clientSeed}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!valid}
            aria-describedby={`${id}-client-seed-hint`}
            onChange={(e) => {
              setClientSeed(e.target.value);
            }}
          />
          <p id={`${id}-client-seed-hint`} className={valid ? 'hint' : 'hint error'}>
            {valid
              ? 'Letters, digits, - and _, up to 64 characters.'
              : 'Use 1 to 64 letters, digits, - or _.'}
          </p>
        </div>
        <button className="button" type="submit" disabled={!valid || busy || rotating}>
          Reveal and rotate seeds
        </button>
        {busy && <p className="hint">Available once the balls land.</p>}
      </form>

      {latest && (
        <div className="revealed" data-testid="revealed-seed">
          <p className="hint">
            Revealed server seed, used for {latest.betCount} bet{latest.betCount === 1 ? '' : 's'}:
          </p>
          <code>{latest.serverSeed}</code>
          <p className="hint">The Verify links in your history now include it.</p>
        </div>
      )}

      {onReset && <ResetDemo busy={busy} onReset={onReset} />}
    </>
  );
}
