/**
 * One watchlist per Market agent, per desk.
 *
 * Each specialist in the rail is its own board: the crypto desk keeps
 * BTC-USD/ETH-USD, the gold desk keeps GC=F/SI=F, and switching between them
 * must not drag one list onto the other. The tickers therefore live under
 * `agentforge-market-watchlist:<workspaceId>:<specialist>` rather than one
 * shared key, and an agent that has never been opened starts from the starter
 * list its core meta names, so every desk has a board the moment it is clicked.
 *
 * Storage is best effort. `localStorage` throws in private mode and is absent
 * under vitest (this package runs node-only), so every read and write is
 * guarded and falls back to a process-lifetime map. The pure helpers are what
 * the tests drive; the hook-facing functions only add the browser store.
 */
import { WATCHLIST_MAX } from "@agentforge/core/market";
import {
  DEFAULT_MARKET_SPECIALIST,
  specialistStarterTickers,
  type MarketSpecialist,
} from "./market-specialist";

export { WATCHLIST_MAX };

/** Key prefix. The desk id and the agent id follow, colon separated. */
export const WATCHLIST_KEY_PREFIX = "agentforge-market-watchlist";

/** What a null workspace (the owner's home desk) is called in the key. */
export const HOME_WATCHLIST_SCOPE = "home";

/** The slice of `Storage` this module needs; a plain object works in tests. */
export type WatchlistStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Used only when the browser has no usable storage (private mode, SSR, vitest). */
const memory = new Map<string, string>();

/** The storage key one desk's copy of one agent's board is written to. */
export function watchlistKey(workspaceId: string | null | undefined, specialist: MarketSpecialist): string {
  const scope = workspaceId && workspaceId.trim() ? workspaceId.trim() : HOME_WATCHLIST_SCOPE;
  return `${WATCHLIST_KEY_PREFIX}:${scope}:${specialist}`;
}

export function browserWatchlistStore(): WatchlistStore | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readRaw(store: WatchlistStore | undefined, key: string): string | null {
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      // Blocked storage: fall through to the in-memory copy.
    }
  }
  return memory.get(key) ?? null;
}

function writeRaw(store: WatchlistStore | undefined, key: string, value: string): void {
  if (store) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      // Quota or private mode: keep the list for this session at least.
    }
  }
  memory.set(key, value);
}

function removeRaw(store: WatchlistStore | undefined, key: string): void {
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      // Nothing to do; the memory copy below is what the session reads.
    }
  }
  memory.delete(key);
}

/**
 * The stored board, or `null` when the key holds nothing we can use. A value
 * that is not an array of non-empty strings counts as nothing: a half-written
 * or hand-edited key must not blank the desk, it must fall back to the starters.
 */
export function parseWatchlist(raw: string | null | undefined): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const tickers: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") {
      return null;
    }
    const ticker = entry.trim();
    if (ticker && !tickers.includes(ticker)) {
      tickers.push(ticker);
    }
  }
  return tickers.slice(0, WATCHLIST_MAX);
}

/** The board to show for one agent: what the desk saved, else the agent's starters. */
export function loadWatchlist(
  workspaceId: string | null | undefined,
  specialist: MarketSpecialist,
  store: WatchlistStore | undefined = browserWatchlistStore(),
): string[] {
  const stored = parseWatchlist(readRaw(store, watchlistKey(workspaceId, specialist)));
  return stored ?? specialistStarterTickers(specialist);
}

/** Remember this agent's board on this desk. Called on every chip change. */
export function saveWatchlist(
  workspaceId: string | null | undefined,
  specialist: MarketSpecialist,
  tickers: ReadonlyArray<string>,
  store: WatchlistStore | undefined = browserWatchlistStore(),
): void {
  const clean = tickers
    .map((ticker) => ticker.trim())
    .filter((ticker, index, all) => ticker !== "" && all.indexOf(ticker) === index)
    .slice(0, WATCHLIST_MAX);
  writeRaw(store, watchlistKey(workspaceId, specialist), JSON.stringify(clean));
}

/** Forget one agent's board, so it opens from its starters again. */
export function clearWatchlist(
  workspaceId: string | null | undefined,
  specialist: MarketSpecialist,
  store: WatchlistStore | undefined = browserWatchlistStore(),
): void {
  removeRaw(store, watchlistKey(workspaceId, specialist));
}

/** The starter board behind an agent that was never opened. */
export function starterWatchlist(specialist: MarketSpecialist = DEFAULT_MARKET_SPECIALIST): string[] {
  return specialistStarterTickers(specialist);
}
