import type { Bet, PlayerState } from '@drop-win/contract';
import { describe, expect, it } from 'vitest';
import {
  displayBalance,
  gameReducer,
  initialGameState,
  type GameState,
} from '../src/game/state.ts';

const hash = 'c'.repeat(64);

function server(balanceCents: number, nonce: number): PlayerState {
  return {
    balanceCents,
    seed: { serverSeedHash: hash, clientSeed: 'seed', nonce },
    canRefill: false,
  };
}

function bet(id: number, amountCents: number, payoutCents: number, balanceAfterCents: number): Bet {
  return {
    id,
    createdAt: 0,
    amountCents,
    rows: 8,
    risk: 'low',
    nonce: id - 1,
    path: 'LRLRLRLR',
    bucket: 4,
    multiplierHundredths: Math.round((payoutCents / amountCents) * 100),
    payoutCents,
    balanceAfterCents,
    clientSeed: 'seed',
    serverSeedHash: hash,
    serverSeed: null,
  };
}

function ready(): GameState {
  return gameReducer(initialGameState, {
    type: 'loaded',
    server: server(10_000, 0),
    history: [],
    nextBefore: null,
  });
}

describe('game state', () => {
  it('holds back winnings until the ball lands', () => {
    let state = ready();
    state = gameReducer(state, { type: 'betRequested' });
    state = gameReducer(state, {
      type: 'betSettled',
      bet: bet(1, 100, 300, 10_200),
      server: server(10_200, 1),
    });
    expect(state.pendingRequests).toBe(0);
    expect(displayBalance(state)).toBe(9_900);
    state = gameReducer(state, { type: 'betLanded', id: 1 });
    expect(displayBalance(state)).toBe(10_200);
    expect(state.history.map((b) => b.id)).toEqual([1]);
    expect(state.flights).toHaveLength(0);
  });

  it('ignores a late response that would roll the balance back', () => {
    let state = ready();
    state = gameReducer(state, { type: 'betRequested' });
    state = gameReducer(state, { type: 'betRequested' });
    state = gameReducer(state, {
      type: 'betSettled',
      bet: bet(2, 100, 50, 9_850),
      server: server(9_850, 2),
    });
    state = gameReducer(state, {
      type: 'betSettled',
      bet: bet(1, 100, 0, 9_900),
      server: server(9_900, 1),
    });
    expect(state.server?.balanceCents).toBe(9_850);
    expect(state.server?.seed.nonce).toBe(2);
    expect(state.flights).toHaveLength(2);
  });

  it('never leaves a request counted as pending after a failure', () => {
    let state = ready();
    state = gameReducer(state, { type: 'betRequested' });
    state = gameReducer(state, { type: 'betFailed' });
    state = gameReducer(state, { type: 'betFailed' });
    expect(state.pendingRequests).toBe(0);
  });

  it('does not duplicate a replayed bet', () => {
    let state = ready();
    const settled = {
      type: 'betSettled',
      bet: bet(1, 100, 100, 10_000),
      server: server(10_000, 1),
    } as const;
    state = gameReducer(gameReducer(state, { type: 'betRequested' }), settled);
    state = gameReducer(gameReducer(state, { type: 'betRequested' }), settled);
    expect(state.flights).toHaveLength(1);
    expect(state.pendingRequests).toBe(0);
  });
});
