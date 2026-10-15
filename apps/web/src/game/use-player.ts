import type { BetRequest } from '@drop-win/contract';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { displayBalance, gameReducer, initialGameState } from './state.ts';

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

export function usePlayer(onNotice: (message: string) => void) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const noticeRef = useRef(onNotice);
  useEffect(() => {
    noticeRef.current = onNotice;
  });

  const load = useCallback(async () => {
    try {
      const server = await api.session();
      const page = await api.history();
      dispatch({ type: 'loaded', server, history: page.bets, nextBefore: page.nextBefore });
    } catch (error) {
      dispatch({ type: 'loadFailed', message: messageOf(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const placeBet = useCallback(
    async (request: BetRequest) => {
      dispatch({ type: 'betRequested' });
      try {
        const receipt = await api.bet(request);
        dispatch({ type: 'betSettled', bet: receipt.bet, server: receipt.state });
      } catch (error) {
        dispatch({ type: 'betFailed' });
        if (error instanceof ApiError && error.status === 401) {
          noticeRef.current('Your session expired, so a new one was started.');
          void load();
          return;
        }
        noticeRef.current(messageOf(error));
      }
    },
    [load],
  );

  const land = useCallback((id: number) => {
    dispatch({ type: 'betLanded', id });
  }, []);

  const rotateSeed = useCallback(async (clientSeed: string) => {
    try {
      const rotation = await api.rotateSeed(clientSeed);
      const page = await api.history();
      dispatch({
        type: 'seedRotated',
        server: rotation.state,
        revealed: rotation.revealed,
        history: page.bets,
      });
      return true;
    } catch (error) {
      noticeRef.current(messageOf(error));
      return false;
    }
  }, []);

  const refill = useCallback(async () => {
    try {
      dispatch({ type: 'serverReplaced', server: await api.refill() });
    } catch (error) {
      noticeRef.current(messageOf(error));
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (!state.nextBefore) return;
    try {
      const page = await api.history(state.nextBefore);
      dispatch({ type: 'olderLoaded', bets: page.bets, nextBefore: page.nextBefore });
    } catch (error) {
      noticeRef.current(messageOf(error));
    }
  }, [state.nextBefore]);

  const busy = state.pendingRequests > 0 || state.flights.length > 0;

  return {
    state,
    displayBalance: displayBalance(state),
    busy,
    retry: load,
    placeBet,
    land,
    rotateSeed,
    refill,
    loadOlder,
  };
}
