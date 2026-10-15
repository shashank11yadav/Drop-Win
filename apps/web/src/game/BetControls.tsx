import { RISKS, ROW_COUNTS, type Risk, type RowCount } from '@drop-win/fairness';
import { useId } from 'react';
import { formatCents } from '../lib/money.ts';

interface BetControlsProps {
  balanceCents: number;
  amountText: string;
  amountError: string | null;
  onAmountChange: (text: string) => void;
  onHalf: () => void;
  onDouble: () => void;
  onMax: () => void;
  risk: Risk;
  onRiskChange: (risk: Risk) => void;
  rows: RowCount;
  onRowsChange: (rows: RowCount) => void;
  /** Rows and risk are fixed while balls are on the board. */
  locked: boolean;
  canDrop: boolean;
  onDrop: () => void;
  inFlight: number;
  canRefill: boolean;
  onRefill: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  onShowShortcuts: () => void;
}

const RISK_LABELS: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const MIN_ROWS = ROW_COUNTS[0];
const MAX_ROWS = ROW_COUNTS[ROW_COUNTS.length - 1];

export function BetControls(props: BetControlsProps) {
  const id = useId();
  const amountId = `${id}-amount`;
  const amountHint = `${id}-amount-hint`;
  const rowsId = `${id}-rows`;

  return (
    <>
      <div className="balance">
        <span className="balance-label">Balance (play money)</span>
        <span className="balance-value" data-testid="balance">
          {formatCents(props.balanceCents)}
        </span>
      </div>
      {props.canRefill && (
        <p className="hint">
          Out of chips.{' '}
          <button className="button small" type="button" onClick={props.onRefill}>
            Refill to $1,000
          </button>
        </p>
      )}

      <div className="field">
        <label htmlFor={amountId}>Bet amount</label>
        <div className="amount-row">
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input
              id={amountId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={props.amountText}
              aria-invalid={props.amountError !== null}
              aria-describedby={amountHint}
              onChange={(e) => {
                props.onAmountChange(e.target.value);
              }}
            />
          </div>
          <button className="button" type="button" onClick={props.onHalf} aria-label="Halve bet">
            ½
          </button>
          <button className="button" type="button" onClick={props.onDouble} aria-label="Double bet">
            2×
          </button>
          <button
            className="button"
            type="button"
            onClick={props.onMax}
            aria-label="Bet the maximum"
          >
            Max
          </button>
        </div>
        <p id={amountHint} className={props.amountError ? 'hint error' : 'hint'}>
          {props.amountError ?? 'Between $0.10 and $500.00 per ball.'}
        </p>
      </div>

      <fieldset className="field" disabled={props.locked}>
        <legend>Risk</legend>
        <div className="segmented">
          {RISKS.map((risk) => (
            <label key={risk}>
              <input
                type="radio"
                name={`${id}-risk`}
                value={risk}
                checked={props.risk === risk}
                onChange={() => {
                  props.onRiskChange(risk);
                }}
              />
              {RISK_LABELS[risk]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor={rowsId}>Rows</label>
        <div className="range-row">
          <input
            id={rowsId}
            type="range"
            min={MIN_ROWS}
            max={MAX_ROWS}
            step={1}
            value={props.rows}
            disabled={props.locked}
            aria-describedby={props.locked ? `${id}-locked` : undefined}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (ROW_COUNTS.includes(value as RowCount)) props.onRowsChange(value as RowCount);
            }}
          />
          <output htmlFor={rowsId}>{props.rows}</output>
        </div>
        {props.locked && (
          <p id={`${id}-locked`} className="hint">
            Risk and rows unlock when the balls land.
          </p>
        )}
      </div>

      <button
        className="button primary"
        type="button"
        disabled={!props.canDrop}
        onClick={props.onDrop}
      >
        Drop ball
        <kbd aria-hidden="true">Space</kbd>
      </button>
      <p className="hint" aria-live="off">
        {props.inFlight > 0 ? `${String(props.inFlight)} in play` : ' '}
      </p>

      <div className="toolbar">
        <button
          className="button small"
          type="button"
          aria-pressed={props.soundOn}
          onClick={props.onToggleSound}
        >
          Sound {props.soundOn ? 'on' : 'off'}
        </button>
        <button className="button small" type="button" onClick={props.onShowShortcuts}>
          Keyboard shortcuts
        </button>
      </div>
    </>
  );
}
