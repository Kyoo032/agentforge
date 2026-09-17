import { describe, expect, it } from "vitest";
import { computeSessions, exchangeForTicker } from "./sessions";
import { MARKET_EXCHANGES, marketSessionSchema, type MarketExchange } from "./watch-schemas";

function rowFor(iso: string, ticker: string) {
  const rows = computeSessions(new Date(iso), [ticker]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("exchangeForTicker", () => {
  it("routes by venue suffix, index prefix, and the crypto pair", () => {
    const cases: Readonly<Record<string, MarketExchange>> = {
      "BBCA.JK": "IDX",
      "^JKSE": "IDX",
      "BTC-USD": "CRYPTO",
      "ETH-USD": "CRYPTO",
      "VOD.L": "LSE",
      "7203.T": "TSE",
      "0700.HK": "HKEX",
      "D05.SI": "SGX",
      "IDR=X": "NYSE",
      "GC=F": "NYSE",
      "^GSPC": "NYSE",
      MU: "NYSE",
      "BRK-B": "NYSE",
    };
    for (const [ticker, exchange] of Object.entries(cases)) {
      expect(exchangeForTicker(ticker)).toBe(exchange);
    }
  });

  it("is case-insensitive and tolerant of surrounding space", () => {
    expect(exchangeForTicker(" bbca.jk ")).toBe("IDX");
    expect(exchangeForTicker("btc-usd")).toBe("CRYPTO");
  });
});

describe("computeSessions IDX", () => {
  // Wednesday 2026-09-09; WIB is UTC+7 all year.
  it("is open in session I and points at the lunch break", () => {
    const row = rowFor("2026-09-09T03:00:00Z", "BBCA.JK"); // 10:00 WIB
    expect(row.exchange).toBe("IDX");
    expect(row.state).toBe("open");
    expect(row.nextChangeAt).toBe("2026-09-09T05:00:00.000Z"); // 12:00 WIB
  });

  it("is closed through the lunch break and reopens for session II", () => {
    const lunch = rowFor("2026-09-09T05:30:00Z", "^JKSE"); // 12:30 WIB
    expect(lunch.exchange).toBe("IDX");
    expect(lunch.state).toBe("closed");
    expect(lunch.nextChangeAt).toBe("2026-09-09T06:30:00.000Z"); // 13:30 WIB
    const afternoon = rowFor("2026-09-09T07:00:00Z", "BBCA.JK"); // 14:00 WIB
    expect(afternoon.state).toBe("open");
    expect(afternoon.nextChangeAt).toBe("2026-09-09T08:50:00.000Z"); // 15:50 WIB
  });

  it("closes after session II and points at the next weekday open", () => {
    const evening = rowFor("2026-09-09T09:00:00Z", "BBCA.JK"); // 16:00 WIB Wednesday
    expect(evening.state).toBe("closed");
    expect(evening.nextChangeAt).toBe("2026-09-10T02:00:00.000Z"); // Thursday 09:00 WIB
  });

  it("skips the weekend", () => {
    const saturday = rowFor("2026-09-12T03:00:00Z", "BBCA.JK"); // 10:00 WIB Saturday
    expect(saturday.state).toBe("closed");
    expect(saturday.nextChangeAt).toBe("2026-09-14T02:00:00.000Z"); // Monday 09:00 WIB
  });
});

describe("computeSessions NYSE", () => {
  it("runs pre, regular, and post on a September (EDT) weekday", () => {
    const pre = rowFor("2026-09-09T13:25:00Z", "MU"); // 09:25 ET
    expect(pre.exchange).toBe("NYSE");
    expect(pre.state).toBe("pre");
    expect(pre.nextChangeAt).toBe("2026-09-09T13:30:00.000Z");
    const open = rowFor("2026-09-09T15:00:00Z", "MU"); // 11:00 ET
    expect(open.state).toBe("open");
    expect(open.nextChangeAt).toBe("2026-09-09T20:00:00.000Z"); // 16:00 ET
    const post = rowFor("2026-09-09T21:00:00Z", "MU"); // 17:00 ET
    expect(post.state).toBe("post");
    expect(post.nextChangeAt).toBe("2026-09-10T00:00:00.000Z"); // 20:00 ET
  });

  it("follows the zone into standard time (EST) in January", () => {
    const pre = rowFor("2026-01-14T14:25:00Z", "GC=F"); // 09:25 EST
    expect(pre.state).toBe("pre");
    expect(pre.nextChangeAt).toBe("2026-01-14T14:30:00.000Z");
    expect(rowFor("2026-01-14T08:59:00Z", "GC=F").state).toBe("closed"); // 03:59 EST
    expect(rowFor("2026-01-14T09:00:00Z", "GC=F").state).toBe("pre"); // 04:00 EST
  });
});

describe("computeSessions other venues", () => {
  it("keeps each venue on its own clock", () => {
    const lse = rowFor("2026-09-09T08:00:00Z", "VOD.L"); // 09:00 BST
    expect(lse.state).toBe("open");
    expect(lse.nextChangeAt).toBe("2026-09-09T15:30:00.000Z"); // 16:30 BST
    const tse = rowFor("2026-09-09T01:00:00Z", "7203.T"); // 10:00 JST
    expect(tse.state).toBe("open");
    expect(tse.nextChangeAt).toBe("2026-09-09T06:00:00.000Z"); // 15:00 JST
    const hkex = rowFor("2026-09-09T02:00:00Z", "0700.HK"); // 10:00 HKT
    expect(hkex.state).toBe("open");
    expect(hkex.nextChangeAt).toBe("2026-09-09T08:00:00.000Z"); // 16:00 HKT
    const sgx = rowFor("2026-09-09T02:00:00Z", "D05.SI"); // 10:00 SGT
    expect(sgx.state).toBe("open");
    expect(sgx.nextChangeAt).toBe("2026-09-09T09:00:00.000Z"); // 17:00 SGT
  });

  it("never closes the crypto clock and has no next change for it", () => {
    for (const iso of ["2026-09-09T03:00:00Z", "2026-09-12T22:00:00Z"]) {
      const row = rowFor(iso, "BTC-USD");
      expect(row.exchange).toBe("CRYPTO");
      expect(row.state).toBe("always");
      expect(row.nextChangeAt).toBeNull();
    }
  });
});

describe("computeSessions output shape", () => {
  const tickers = ["MU", "BBCA.JK", "BTC-USD", "^JKSE", "AAPL", "0700.HK"];

  it("emits one row per exchange, deduped, in the canonical exchange order", () => {
    const rows = computeSessions(new Date("2026-09-09T03:00:00Z"), tickers);
    expect(rows.map((row) => row.exchange)).toEqual(["IDX", "NYSE", "HKEX", "CRYPTO"]);
    const order = rows.map((row) => MARKET_EXCHANGES.indexOf(row.exchange));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("emits rows the schema accepts, with a parseable next change", () => {
    for (const row of computeSessions(new Date("2026-09-09T03:00:00Z"), tickers)) {
      expect(marketSessionSchema.parse(row)).toEqual(row);
      if (row.nextChangeAt !== null) {
        expect(Number.isNaN(Date.parse(row.nextChangeAt))).toBe(false);
        expect(Date.parse(row.nextChangeAt)).toBeGreaterThan(Date.parse("2026-09-09T03:00:00Z"));
      }
    }
  });

  it("returns nothing for an empty watchlist and refuses an invalid instant", () => {
    expect(computeSessions(new Date("2026-09-09T03:00:00Z"), [])).toEqual([]);
    expect(() => computeSessions(new Date("nope"), ["MU"])).toThrow(RangeError);
  });

  it("is pure: the same inputs give the same rows", () => {
    const now = new Date("2026-09-09T03:00:00Z");
    expect(computeSessions(now, tickers)).toEqual(computeSessions(now, tickers));
  });
});
