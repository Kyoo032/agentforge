import { describe, expect, it } from "vitest";
import { chooseRetriedPacket, isQuietSourceFailure, needsSourceRetry, quietSourceGapCount } from "./packet-retry";
import { makePacket, makeTickerPacket } from "./watch-fixtures";

describe("quiet source retry", () => {
  it("retries a source that stayed quiet and does not retry an unknown symbol", () => {
    expect(isQuietSourceFailure("news: ECONNRESET")).toBe(true);
    expect(isQuietSourceFailure("macro: timeout")).toBe(true);
    expect(isQuietSourceFailure("tradingview: america: HTTP 429")).toBe(true);
    expect(isQuietSourceFailure("news: no headlines returned")).toBe(false);
    expect(isQuietSourceFailure("ZZZZ: unknown symbol")).toBe(false);
    expect(isQuietSourceFailure("hello: not a ticker")).toBe(false);
    expect(isQuietSourceFailure("  ")).toBe(false);

    const quiet = {
      packet: makePacket({ tickers: [makeTickerPacket("MU", { failures: ["news: ECONNRESET"] })] }),
      failures: ["ZZZZ: unknown symbol"],
    };
    expect(needsSourceRetry(quiet)).toBe(true);
    expect(quietSourceGapCount(quiet)).toBe(1);

    const unknownOnly = { packet: makePacket(), failures: ["ZZZZ: unknown symbol"] };
    expect(needsSourceRetry(unknownOnly)).toBe(false);
  });

  it("keeps the attempt with fewer holes, and the first attempt on a tie", () => {
    const first = {
      packet: makePacket({ tickers: [makeTickerPacket("MU", { failures: ["news: ECONNRESET"] })] }),
      failures: [] as string[],
    };
    const second = { packet: makePacket({ tickers: [makeTickerPacket("MU")] }), failures: [] as string[] };
    expect(chooseRetriedPacket(first, second)).toBe(second);

    const worse = {
      packet: makePacket({
        tickers: [makeTickerPacket("MU", { failures: ["news: ECONNRESET", "quote: timeout"] })],
      }),
      failures: [] as string[],
    };
    expect(chooseRetriedPacket(first, worse)).toBe(first);
    expect(chooseRetriedPacket(first, first)).toBe(first);
  });

  it("keeps a second pass that resolves tickers the first pass could not", () => {
    const empty = { packet: makePacket({ tickers: [] }), failures: ["mu: ECONNRESET"] };
    const filled = {
      packet: makePacket({ tickers: [makeTickerPacket("MU", { failures: ["news: timeout"] })] }),
      failures: [],
    };
    expect(chooseRetriedPacket(empty, filled)).toBe(filled);
    expect(needsSourceRetry(empty)).toBe(true);
  });
});
