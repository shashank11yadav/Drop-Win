import { MAX_BET_CENTS, MIN_BET_CENTS } from '@drop-win/contract';
import {
  formatMultiplier,
  isRisk,
  isRowCount,
  multiplierTable,
  type Risk,
  type RowCount,
} from '@drop-win/fairness';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '../board/Board.tsx';
import { centsToInput, formatCents, parseAmountToCents } from '../lib/money.ts';
import { playLanding, playPeg, unlockAudio } from '../lib/sound.ts';
import { readPreference, writePreference } from '../lib/storage.ts';
import { usePrefersReducedMotion } from '../lib/use-media-query.ts';
import { BetControls } from './BetControls.tsx';
import { FairnessPanel } from './FairnessPanel.tsx';
import { HistoryTable } from './HistoryTable.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { usePlayer } from './use-player.ts';

/** Caps on concurrent work, so holding Space cannot queue hundreds of bets. */
const MAX_PENDING_REQUESTS = 4;
const MAX_BALLS_IN_FLIGHT = 24;

function initialRows(): RowCount {
  const stored = Number(readPreference('rows'));
  return isRowCount(stored) ? stored : 12;
}

function initialRisk(): Risk {
  const stored = readPreference('risk');
  return isRisk(stored) ? stored : 'medium';
}

function initialAmount(): string {
  const cents = parseAmountToCents(readPreference('amount') ?? '');
  return centsToInput(
    cents !== null && cents >= MIN_BET_CENTS && cents <= MAX_BET_CENTS ? cents : 100,
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function PlayPage() {
  const [notice, setNotice] = useState('');
  const showNotice = useCallback((message: string) => {
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice('');
    }, 4500);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  const player = usePlayer(showNotice);
  const { state, displayBalance, busy } = player;
  const reducedMotion = usePrefersReducedMotion();

  const [rows, setRows] = useState<RowCount>(initialRows);
  const [risk, setRisk] = useState<Risk>(initialRisk);
  const [amountText, setAmountText] = useState(initialAmount);
  const [soundOn, setSoundOn] = useState(() => readPreference('sound') === 'on');
  const [announcement, setAnnouncement] = useState('');
  const shortcutsRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    writePreference('rows', String(rows));
    writePreference('risk', risk);
    writePreference('sound', soundOn ? 'on' : 'off');
  }, [rows, risk, soundOn]);

  const amountCents = parseAmountToCents(amountText);
  let amountError: string | null = null;
  if (amountCents === null) amountError = 'Enter an amount such as 1.50.';
  else if (amountCents < MIN_BET_CENTS)
    amountError = `Minimum bet is ${formatCents(MIN_BET_CENTS)}.`;
  else if (amountCents > MAX_BET_CENTS)
    amountError = `Maximum bet is ${formatCents(MAX_BET_CENTS)}.`;
  else if (state.server && amountCents > displayBalance) amountError = 'Not enough balance.';

  const saturated =
    state.pendingRequests >= MAX_PENDING_REQUESTS || state.flights.length >= MAX_BALLS_IN_FLIGHT;
  const canDrop = state.status === 'ready' && amountError === null && !saturated;
  const table = multiplierTable(risk, rows);

  // The board's table must stay the one the balls were dropped with.
  const boardTable = state.flights[0]
    ? multiplierTable(state.flights[0].risk, state.flights[0].rows)
    : table;
  const boardRows = state.flights[0]?.rows ?? rows;

  const drop = useCallback(() => {
    if (!canDrop || amountCents === null) return;
    if (soundOn) unlockAudio();
    writePreference('amount', centsToInput(amountCents));
    void player.placeBet({ amountCents, rows, risk });
  }, [canDrop, amountCents, rows, risk, soundOn, player]);

  const scaleAmount = useCallback(
    (factor: number) => {
      const current = amountCents ?? MIN_BET_CENTS;
      const next = Math.min(MAX_BET_CENTS, Math.max(MIN_BET_CENTS, Math.floor(current * factor)));
      setAmountText(centsToInput(next));
    },
    [amountCents],
  );

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      if (!on) unlockAudio();
      return !on;
    });
  }, []);

  const onLand = useCallback(
    (id: number) => {
      const bet = state.flights.find((b) => b.id === id);
      player.land(id);
      if (!bet) return;
      if (soundOn) playLanding(bet.multiplierHundredths);
      const profit = bet.payoutCents - bet.amountCents;
      setAnnouncement(
        `Landed on ${formatMultiplier(bet.multiplierHundredths)}. ${
          profit >= 0 ? `Won ${formatCents(profit)}` : `Lost ${formatCents(-profit)}`
        }.`,
      );
    },
    [state.flights, player, soundOn],
  );

  const onPegTouch = useCallback(
    (row: number) => {
      if (soundOn) playPeg(row);
    },
    [soundOn],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const onButton = event.target instanceof HTMLButtonElement;
      switch (event.key) {
        case ' ':
          // A focused button already handles Space itself.
          if (onButton) return;
          event.preventDefault();
          drop();
          break;
        case 'h':
          scaleAmount(0.5);
          break;
        case 'd':
          scaleAmount(2);
          break;
        case 'm':
          toggleSound();
          break;
        case '?':
          shortcutsRef.current?.showModal();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [drop, scaleAmount, toggleSound]);

  if (state.status === 'loading') {
    return <p role="status">Starting a session...</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="panel" role="alert">
        <p>Could not start a session: {state.loadError}</p>
        <button className="button" type="button" onClick={() => void player.retry()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <main className="play">
      <h1 className="sr-only">Play Drop-Win</h1>
      <section className="panel board-panel area-board" aria-label="Board">
        <Board
          rows={boardRows}
          table={boardTable}
          flights={state.flights}
          reducedMotion={reducedMotion}
          onLand={onLand}
          onPegTouch={onPegTouch}
          label={`Board with ${String(boardRows)} rows of pegs.`}
        />
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </section>

      <section className="panel area-controls" aria-label="Bet">
        <BetControls
          balanceCents={displayBalance}
          amountText={amountText}
          amountError={amountError}
          onAmountChange={setAmountText}
          onHalf={() => {
            scaleAmount(0.5);
          }}
          onDouble={() => {
            scaleAmount(2);
          }}
          onMax={() => {
            setAmountText(
              centsToInput(Math.max(MIN_BET_CENTS, Math.min(MAX_BET_CENTS, displayBalance))),
            );
          }}
          risk={risk}
          onRiskChange={setRisk}
          rows={rows}
          onRowsChange={setRows}
          locked={busy}
          canDrop={canDrop}
          onDrop={drop}
          inFlight={state.flights.length + state.pendingRequests}
          canRefill={(state.server?.canRefill ?? false) && !busy}
          onRefill={() => void player.refill()}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          onShowShortcuts={() => shortcutsRef.current?.showModal()}
        />
      </section>

      {state.server && (
        <section className="panel area-fairness" aria-labelledby="fairness-heading">
          <FairnessPanel
            seed={state.server.seed}
            revealed={state.revealed}
            busy={busy}
            onRotate={player.rotateSeed}
            onReset={player.reset}
          />
        </section>
      )}

      <section className="panel area-history" aria-label="History">
        <HistoryTable
          bets={state.history}
          hasMore={state.nextBefore !== null}
          onLoadMore={() => void player.loadOlder()}
        />
      </section>

      <ShortcutsDialog ref={shortcutsRef} />
      <div className="notice" role="status" aria-live="polite">
        {notice}
      </div>
    </main>
  );
}
