/**
 * The DATA PACKET block as each desk's harness shapes it: which sections are
 * rendered, in what order, at what precision, and whether every figure the
 * model is shown survives the number guard.
 */
import { describe, expect, it } from "vitest";
import { packetNumbers, packetToPromptBlock } from "./briefing-prompt";
import { harnessFor } from "./harness";
import { MARKET_SPECIALISTS } from "./specialist-ids";
import { metalsLines } from "./packet-sections";
import { FIXTURE_METALS, makeFullPacket, makePacket, makeTickerPacket } from "./watch-fixtures";

describe("packetToPromptBlock follows the desk's harness", () => {
  const packet = makeFullPacket();

  /** Where each harness source shows up in the rendered block. */
  const MARKERS: Readonly<Record<string, string>> = {
    macro: "MACRO:",
    metals: "METALS CONTEXT:",
    signals: "SIGNALS (computed):",
    rotation: "ROTATION (computed",
    sessions: "SESSIONS:",
    quotes: "- quote:",
    technicals: "- technical:",
    headlines: "- news:",
    swings: "- swings:",
    crypto: "CRYPTO GLOBAL:",
    fundamentals: "- FUNDAMENTALS:",
    insiders: "- INSIDERS:",
    sentiment: "- SENTIMENT:",
    globalNews: "GLOBAL NEWS",
  };

  it("renders every section in packetOrder and no section outside it", () => {
    for (const id of MARKET_SPECIALISTS) {
      const order = harnessFor(id).packetOrder;
      const text = packetToPromptBlock(packet, id);
      for (const [source, marker] of Object.entries(MARKERS)) {
        const expected = order.includes(source as (typeof order)[number]);
        expect({ id, source, shown: text.includes(marker) }).toEqual({ id, source, shown: expected });
      }
    }
  });

  it("prints the packet-level sections in the order the harness lists them", () => {
    const summary = packetToPromptBlock(packet, "summary");
    expect(summary.indexOf("MACRO:")).toBeLessThan(summary.indexOf("SESSIONS:"));
    expect(summary.indexOf("SESSIONS:")).toBeLessThan(summary.indexOf("TICKER MU"));
    const crypto = packetToPromptBlock(packet, "crypto");
    expect(crypto.indexOf("CRYPTO GLOBAL:")).toBeLessThan(crypto.indexOf("TICKER MU"));
  });

  it("renders the crypto, metals, signals, rotation and session rows at presentation precision", () => {
    const crypto = packetToPromptBlock(packet, "crypto");
    expect(crypto).toContain("CRYPTO GLOBAL: total market cap 3912000000000");
    expect(crypto).toContain("BTC dominance +54.12%");
    expect(crypto).toContain("- crypto: mkt cap 1284000000000");
    expect(crypto).toContain("7 days -4.25%");
    expect(crypto).toContain("funding rate +0.01%");
    const gold = packetToPromptBlock(packet, "gold");
    expect(gold).toContain("METALS CONTEXT: DXY 97.41, US 10-year yield 4.13, gold/silver ratio 82.53");
    expect(gold).toContain("futures versus spot +0.34%");
    expect(gold).toContain("futures vs GLD n/a");
    const scanner = packetToPromptBlock(packet, "scanner");
    expect(scanner).toContain("| MU | rsi-overbought | 71.30 | RSI14 sits in the overbought band |");
    const rotation = packetToPromptBlock(packet, "sector-rotation");
    expect(rotation).toContain("| 1 | MU | -1.20% | +3.05% | +8.42% | +41.70% |");
    expect(rotation).toContain("| 2 | INTC |");
    expect(rotation).toContain("| n/a |");
    const summary = packetToPromptBlock(packet, "summary");
    expect(summary).toContain("- IDX: closed, next change 2026-09-10T02:00Z");
    expect(summary).toContain("- CRYPTO: always open, no scheduled change");
  });

  it("never prints a raw float or a millisecond stamp below the clock line", () => {
    for (const id of MARKET_SPECIALISTS) {
      const text = packetToPromptBlock(packet, id);
      const body = text.slice(text.indexOf("\n"));
      expect({ id, raw: /\d\.\d{3,}/.test(body) }).toEqual({ id, raw: false });
    }
  });

  it("says so when a computed section was asked for but came back empty", () => {
    const empty = makeFullPacket({ signals: [], rotation: [], sessions: [] });
    expect(packetToPromptBlock(empty, "scanner")).toContain("SIGNALS: none");
    expect(packetToPromptBlock(empty, "sector-rotation")).toContain("ROTATION: none");
    expect(packetToPromptBlock(empty, "summary")).toContain("SESSIONS: none");
  });

  /**
   * `GLD` is an ETF share net of fees, not spot gold. The packet prints the
   * proxy premium in its own cell so the model can never read it as a real
   * futures-versus-spot basis.
   */
  it("prints the GLD proxy premium under its own name, beside an empty spot basis", () => {
    const [line] = metalsLines({
      goldFuturesVsGldPct: 1.0266,
      source: FIXTURE_METALS.source,
      observedAt: FIXTURE_METALS.observedAt,
    });
    expect(line).toContain("futures versus spot n/a");
    expect(line).toContain("futures vs GLD +1.03%");
  });

  it("renders the fundamentals, insider, sentiment and global-news rows at presentation precision", () => {
    const saham = packetToPromptBlock(packet, "saham");
    expect(saham).toContain("- FUNDAMENTALS: sector Technology, industry Semiconductors, mkt cap 990000000000");
    expect(saham).toContain("trailing P/E 24.53");
    expect(saham).toContain("dividend yield +0.45%");
    expect(saham).toContain("revenue over the last 12 months 37100000000");
    expect(saham).toContain("- INSIDERS: last 90 days, buy filings 3, sell filings 7, net shares -128400");
    expect(saham).toContain("- SENTIMENT: StockTwits 184 messages (bullish 121, bearish 39, sampled 3)");
    expect(saham).toContain("Reddit 17 posts in wallstreetbets, stocks");
    expect(saham).toContain('- sample (stocktwits, mood only): "Volume looks heavy into the close"');
    const news = packetToPromptBlock(packet, "news");
    expect(news).toContain("GLOBAL NEWS (fixed macro queries):");
    expect(news).toContain("Fed holds its policy rate at 4.25% and points to a slower path — Reuters");
    expect(news).toContain("[query: Federal Reserve interest rate decision]");
  });

  it("keeps a venue that answered with nothing apart from a venue that did not answer", () => {
    const quiet = makeFullPacket({
      tickers: [
        makeTickerPacket("MU", {
          sentiment: {
            reddit: { posts: 0, subreddits: ["stocks"] },
            samples: [],
            observedAt: FIXTURE_METALS.observedAt,
          },
        }),
      ],
    });
    const block = packetToPromptBlock(quiet, "saham");
    expect(block).toContain("StockTwits n/a");
    expect(block).toContain("Reddit 0 posts in stocks");
    expect(block).toContain("- samples: none");
  });

  it("omits a section the host never computed, without a placeholder", () => {
    const bare = makePacket();
    expect(packetToPromptBlock(bare, "scanner")).not.toContain("SIGNALS");
    expect(packetToPromptBlock(bare, "sector-rotation")).not.toContain("ROTATION");
    expect(packetToPromptBlock(bare, "gold")).not.toContain("METALS");
    expect(packetToPromptBlock(bare, "crypto")).not.toContain("CRYPTO GLOBAL");
    expect(packetToPromptBlock(bare, "crypto")).toContain("- crypto: n/a");
  });
});

describe("packetNumbers covers every harness section", () => {
  const packet = makeFullPacket();
  const numbers = packetNumbers(packet, "");

  it("allows every numeric field of the new sections", () => {
    const expected = [
      // cryptoGlobal
      3_912_000_000_000, 54.12, 13.24,
      // metals
      97.41, 4.126, 82.53, 0.34,
      // ticker crypto
      1_284_000_000_000, 34_500_000_000, -4.25, 0.0112,
      // signals
      71.3, 401.2,
      // rotation (returns and ranks)
      -1.2, 3.05, 8.42, 41.7, 0.4, -2.11, -6.38, 1, 2,
      // swings
      910.5, 700.25,
    ];
    for (const value of expected) {
      expect({ value, allowed: numbers.includes(value) }).toEqual({ value, allowed: true });
    }
  });

  it("also allows the rounded presentation of each new figure the model actually sees", () => {
    for (const value of [4.13, 54.1, 82.5, -4.3, 8.4, 41.7]) {
      expect({ value, allowed: numbers.includes(value) }).toEqual({ value, allowed: true });
    }
  });

  it("allows the GLD proxy premium once the packet carries it", () => {
    const withGld = packetNumbers(makeFullPacket({ metals: { ...FIXTURE_METALS, goldFuturesVsGldPct: 1.0266 } }), "");
    expect(withGld).toContain(1.0266);
    // and the rounded figure the model actually reads off the block
    expect(withGld).toContain(1.03);
    expect(numbers).not.toContain(1.0266);
  });

  it("is unchanged for a packet with none of the new sections", () => {
    const bare = makePacket();
    expect(packetNumbers(bare, bare.positionContext)).toEqual(packetNumbers(bare, bare.positionContext));
    expect(packetNumbers(bare, "")).not.toContain(3_912_000_000_000);
  });
});
