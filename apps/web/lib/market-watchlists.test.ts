import { beforeEach, describe, expect, it } from "vitest";
import { MARKET_SPECIALIST_META } from "@agentforge/core/market";
import {
  HOME_WATCHLIST_SCOPE,
  WATCHLIST_KEY_PREFIX,
  WATCHLIST_MAX,
  clearWatchlist,
  loadWatchlist,
  parseWatchlist,
  saveWatchlist,
  starterWatchlist,
  watchlistKey,
  type WatchlistStore,
} from "./market-watchlists";

/** A localStorage stand-in; `apps/web` runs vitest without a DOM. */
function fakeStore(seed: Record<string, string> = {}): WatchlistStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** A desk whose storage is blocked, the way private mode behaves. */
function blockedStore(): WatchlistStore {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

let store = fakeStore();

beforeEach(() => {
  store = fakeStore();
});

describe("watchlist keys", () => {
  it("scopes a board to one desk and one agent", () => {
    expect(watchlistKey("ws-7", "crypto")).toBe(`${WATCHLIST_KEY_PREFIX}:ws-7:crypto`);
    expect(watchlistKey("ws-7", "gold")).not.toBe(watchlistKey("ws-7", "crypto"));
  });

  it("names the owner's home desk rather than writing a null into the key", () => {
    expect(watchlistKey(null, "saham")).toBe(`${WATCHLIST_KEY_PREFIX}:${HOME_WATCHLIST_SCOPE}:saham`);
    expect(watchlistKey(undefined, "saham")).toBe(watchlistKey(null, "saham"));
    expect(watchlistKey("   ", "saham")).toBe(watchlistKey(null, "saham"));
  });
});

describe("loadWatchlist", () => {
  it("opens an unseen agent on its own starter board", () => {
    expect(loadWatchlist("ws-1", "crypto", store)).toEqual([...MARKET_SPECIALIST_META.crypto.starterTickers]);
    expect(loadWatchlist("ws-1", "gold", store)).toEqual([...MARKET_SPECIALIST_META.gold.starterTickers]);
    // Two agents, two different boards — that is the whole point of the split.
    expect(loadWatchlist("ws-1", "crypto", store)).not.toEqual(loadWatchlist("ws-1", "gold", store));
  });

  it("hands back a fresh array the caller may keep in state", () => {
    const first = loadWatchlist("ws-1", "crypto", store);
    first.push("DOGE-USD");
    expect(loadWatchlist("ws-1", "crypto", store)).toEqual([...MARKET_SPECIALIST_META.crypto.starterTickers]);
  });

  it("round-trips what was saved", () => {
    saveWatchlist("ws-1", "crypto", ["BTC-USD", "XRP-USD"], store);
    expect(loadWatchlist("ws-1", "crypto", store)).toEqual(["BTC-USD", "XRP-USD"]);
  });

  it("keeps an emptied board empty instead of re-seeding the starters", () => {
    saveWatchlist("ws-1", "crypto", [], store);
    expect(loadWatchlist("ws-1", "crypto", store)).toEqual([]);
  });

  it("falls back to the starters when the key holds something unusable", () => {
    const key = watchlistKey("ws-1", "gold");
    for (const corrupt of ["{", "not json", '{"tickers":["GC=F"]}', "[1,2,3]", '"GC=F"', "null"]) {
      store.map.set(key, corrupt);
      expect(loadWatchlist("ws-1", "gold", store), corrupt).toEqual([...MARKET_SPECIALIST_META.gold.starterTickers]);
    }
  });

  it("keeps one desk's board out of another's", () => {
    saveWatchlist("ws-1", "crypto", ["XRP-USD"], store);
    saveWatchlist("ws-2", "crypto", ["SOL-USD"], store);
    expect(loadWatchlist("ws-1", "crypto", store)).toEqual(["XRP-USD"]);
    expect(loadWatchlist("ws-2", "crypto", store)).toEqual(["SOL-USD"]);
    expect(loadWatchlist(null, "crypto", store)).toEqual([...MARKET_SPECIALIST_META.crypto.starterTickers]);
  });

  it("forgets a board on request so the agent opens from its starters again", () => {
    saveWatchlist("ws-1", "gold", ["GC=F"], store);
    clearWatchlist("ws-1", "gold", store);
    expect(loadWatchlist("ws-1", "gold", store)).toEqual([...MARKET_SPECIALIST_META.gold.starterTickers]);
  });
});

describe("saveWatchlist", () => {
  it("writes JSON under the scoped key", () => {
    saveWatchlist("ws-1", "crypto", ["BTC-USD"], store);
    expect(store.map.get(watchlistKey("ws-1", "crypto"))).toBe('["BTC-USD"]');
  });

  it("drops blanks and duplicates and honours the shared cap", () => {
    saveWatchlist("ws-1", "saham", ["BBCA", " ", "BBCA", "BBRI"], store);
    expect(loadWatchlist("ws-1", "saham", store)).toEqual(["BBCA", "BBRI"]);

    const many = Array.from({ length: WATCHLIST_MAX + 6 }, (_, index) => `T${index}`);
    saveWatchlist("ws-1", "scanner", many, store);
    expect(loadWatchlist("ws-1", "scanner", store)).toHaveLength(WATCHLIST_MAX);
  });
});

describe("blocked storage", () => {
  it("keeps the board for the session instead of throwing at the studio", () => {
    const blocked = blockedStore();
    expect(() => saveWatchlist("ws-blocked", "crypto", ["XRP-USD"], blocked)).not.toThrow();
    expect(loadWatchlist("ws-blocked", "crypto", blocked)).toEqual(["XRP-USD"]);
    expect(() => clearWatchlist("ws-blocked", "crypto", blocked)).not.toThrow();
    expect(loadWatchlist("ws-blocked", "crypto", blocked)).toEqual([
      ...MARKET_SPECIALIST_META.crypto.starterTickers,
    ]);
  });

  it("does the same when there is no storage object at all", () => {
    expect(() => saveWatchlist("ws-none", "gold", ["GC=F"], undefined)).not.toThrow();
    expect(loadWatchlist("ws-none", "gold", undefined)).toEqual(["GC=F"]);
    clearWatchlist("ws-none", "gold", undefined);
  });
});

describe("parseWatchlist", () => {
  it("reads a clean array and refuses anything else", () => {
    expect(parseWatchlist('["BTC-USD","ETH-USD"]')).toEqual(["BTC-USD", "ETH-USD"]);
    expect(parseWatchlist("[]")).toEqual([]);
    expect(parseWatchlist(null)).toBeNull();
    expect(parseWatchlist("")).toBeNull();
    expect(parseWatchlist("[")).toBeNull();
    expect(parseWatchlist('{"a":1}')).toBeNull();
    expect(parseWatchlist('["BTC-USD",7]')).toBeNull();
  });
});

describe("starterWatchlist", () => {
  it("defaults to the default agent's board", () => {
    expect(starterWatchlist()).toEqual([...MARKET_SPECIALIST_META.saham.starterTickers]);
    expect(starterWatchlist("indices")).toEqual([...MARKET_SPECIALIST_META.indices.starterTickers]);
  });
});
