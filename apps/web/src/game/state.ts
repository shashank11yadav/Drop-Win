import type { Bet, PlayerState, RevealedSeed } from '@drop-win/contract';

export interface GameState {
  status: 'loading' | 'ready' | 'error';
  loadError: string | null;
  /** Latest state from the server, which already includes payouts of balls still falling. */
  server: PlayerState | null;
  /** Bet id the `server` snapshot belongs to, so late responses cannot roll it back. */
  serverBetId: number;
  pendingRequests: number;
  /** Bets the server has settled whose balls are still on the board. */
  flights: Bet[];
  /** Landed bets, newest first. */
  history: Bet[];
  nextBefore: string | null;
  revealed: RevealedSeed[];
}

export type GameAction =
  | { type: 'loaded'; server: PlayerState; history: Bet[]; nextBefore: string | null }
  | { type: 'loadFailed'; message: string }
  | { type: 'betRequested' }
  | { type: 'betFailed' }
  | { type: 'betSettled'; bet: Bet; server: PlayerState }
  | { type: 'betLanded'; id: number }
  | { type: 'serverReplaced'; server: PlayerState }
  | { type: 'seedRotated'; server: PlayerState; revealed: RevealedSeed; history: Bet[] }
  | { type: 'olderLoaded'; bets: Bet[]; nextBefore: string | null };

export const initialGameState: GameState = {
  status: 'loading',
  loadError: null,
  server: null,
  serverBetId: 0,
  pendingRequests: 0,
  flights: [],
  history: [],
  nextBefore: null,
  revealed: [],
};

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'loaded': {
      const latest = action.history[0]?.id ?? 0;
      return {
        ...initialGameState,
        status: 'ready',
        server: action.server,
        serverBetId: latest,
        history: action.history,
        nextBefore: action.nextBefore,
      };
    }
    case 'loadFailed':
      return { ...state, status: 'error', loadError: action.message };
    case 'betRequested':
      return { ...state, pendingRequests: state.pendingRequests + 1 };
    case 'betFailed':
      return { ...state, pendingRequests: Math.max(0, state.pendingRequests - 1) };
    case 'betSettled': {
      const known =
        state.flights.some((b) => b.id === action.bet.id) ||
        state.history.some((b) => b.id === action.bet.id);
      const newer = action.bet.id > state.serverBetId;
      return {
        ...state,
        pendingRequests: Math.max(0, state.pendingRequests - 1),
        server: newer ? action.server : state.server,
        serverBetId: newer ? action.bet.id : state.serverBetId,
        flights: known ? state.flights : [...state.flights, action.bet],
      };
    }
    case 'betLanded': {
      const bet = state.flights.find((b) => b.id === action.id);
      if (!bet) return state;
      return {
        ...state,
        flights: state.flights.filter((b) => b.id !== action.id),
        history: [bet, ...state.history],
      };
    }
    case 'serverReplaced':
      return { ...state, server: action.server };
    case 'seedRotated':
      return {
        ...state,
        server: action.server,
        history: action.history,
        revealed: [action.revealed, ...state.revealed],
      };
    case 'olderLoaded':
      return {
        ...state,
        history: [
          ...state.history,
          ...action.bets.filter((b) => !state.history.some((h) => h.id === b.id)),
        ],
        nextBefore: action.nextBefore,
      };
  }
}

/** Balance shown to the player: winnings still falling are not counted until they land. */
export function displayBalance(state: GameState): number {
  if (!state.server) return 0;
  return state.flights.reduce((sum, bet) => sum - bet.payoutCents, state.server.balanceCents);
}
