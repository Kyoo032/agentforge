"use client";

import { useEffect, useState } from "react";
import { fetchMarketBoard, friendlyMarketError, type MarketBoard } from "./market-client";

/** Chips settle for this long before the board is fetched, so pasting a list makes one request. */
export const BOARD_DEBOUNCE_MS = 400;

const SEPARATOR = "|";

export type MarketBoardState = {
  board: MarketBoard | null;
  loading: boolean;
  error: string | null;
  /** Fetch again for the same watchlist (quotes are cached for a few minutes on the host). */
  refresh: () => void;
};

const IDLE = { board: null, loading: false, error: null } as const;

/** "3|MU,NVDA" -> ["MU", "NVDA"]. The leading count is what makes a refresh a new fetch. */
export function tickersOf(reloadKey: string): string[] {
  const list = reloadKey.slice(reloadKey.indexOf(SEPARATOR) + 1);
  return list === "" ? [] : list.split(",");
}

/**
 * The keyless watch board for the current chips. Re-fetches when the list
 * changes or `refresh` is called; a request that is superseded is aborted and
 * its result dropped. The previous board stays on screen while a new one loads.
 */
export function useMarketBoard(tickers: ReadonlyArray<string>): MarketBoardState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<MarketBoardState, "refresh">>(IDLE);
  const reloadKey = `${tick}${SEPARATOR}${tickers.join(",")}`;

  useEffect(() => {
    const wanted = tickersOf(reloadKey);
    if (wanted.length === 0) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      fetchMarketBoard(wanted, controller.signal)
        .then((board) => {
          if (!controller.signal.aborted) {
            setState({ board, loading: false, error: null });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          const message = error instanceof Error ? error.message : "Could not load the watchlist";
          setState((current) => ({ board: current.board, loading: false, error: friendlyMarketError(message) }));
        });
    }, BOARD_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [reloadKey]);

  return { ...state, refresh: () => setTick((value) => value + 1) };
}
