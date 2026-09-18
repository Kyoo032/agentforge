import { describe, expect, it } from "vitest";
import {
  CROSS_LOOKBACK_BARS,
  RANGE_PROXIMITY_PCT,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  UNUSUAL_MOVE_MULTIPLE,
  UNUSUAL_MOVE_WINDOW_BARS,
  computeSignals,
} from "./signals";
import { makeHistory, makePacket, makeQuote, makeTechnical, makeTickerPacket } from "./watch-fixtures";
import { MARKET_SIGNAL_KINDS, SIGNAL_NOTE_MAX, marketSignalSchema } from "./watch-schemas";

/** A packet holding exactly the tickers given, with no macro and no position context. */
function only(...tickers: ReturnType<typeof makeTickerPacket>[]) {
  return makePacket({ tickers, macro: { quotes: [], failures: [] }, positionContext: "" });
}

function kindsFor(packet: ReturnType<typeof makePacket>, ticker: string): string[] {
  return computeSignals(packet)
    .filter((signal) => signal.ticker === ticker)
    .map((signal) => signal.kind);
}

/** Closes that walk down to `length - 1` and then turn up over the last `turn` bars. */
function vShape(length: number, turn: number, step: number): (index: number) => number {
  return (index) => (index < length - turn ? 300 - index : 300 - (length - turn) + (index - (length - turn)) * step);
}

describe("computeSignals RSI band", () => {
  it("reports an oversold reading with the RSI itself as the value", () => {
    const packet = only(
      makeTickerPacket("MU", { technical: makeTechnical("MU", { rsi14: RSI_OVERSOLD - 2 }), history: null }),
    );
    const [signal] = computeSignals(packet);
    expect(signal.ticker).toBe("MU");
    expect(signal.kind).toBe("rsi-oversold");
    expect(signal.value).toBe(RSI_OVERSOLD - 2);
    expect(signal.note.length).toBeGreaterThan(5);
  });

  it("reports an overbought reading and nothing in between", () => {
    const over = only(
      makeTickerPacket("MU", { technical: makeTechnical("MU", { rsi14: RSI_OVERBOUGHT }), history: null }),
    );
    expect(kindsFor(over, "MU")).toEqual(["rsi-overbought"]);
    const mid = only(makeTickerPacket("MU", { technical: makeTechnical("MU", { rsi14: 50 }), history: null }));
    expect(kindsFor(mid, "MU")).toEqual([]);
    const edge = only(
      makeTickerPacket("MU", { technical: makeTechnical("MU", { rsi14: RSI_OVERSOLD }), history: null }),
    );
    expect(kindsFor(edge, "MU")).toEqual(["rsi-oversold"]);
  });

  it("says nothing when there is no technical row at all", () => {
    expect(computeSignals(only(makeTickerPacket("MU", { technical: null, history: null })))).toEqual([]);
  });
});

describe("computeSignals MACD cross", () => {
  const flatTechnical = () => makeTechnical("MU", { rsi14: 50, high52w: 1e6, low52w: 0 });

  it("sees the line cross above its signal in the closing bars", () => {
    const packet = only(
      makeTickerPacket("MU", {
        technical: flatTechnical(),
        history: makeHistory("MU", 120, vShape(120, CROSS_LOOKBACK_BARS, 30)),
      }),
    );
    expect(kindsFor(packet, "MU")).toContain("macd-bull-cross");
    expect(kindsFor(packet, "MU")).not.toContain("macd-bear-cross");
  });

  it("sees the mirror cross below", () => {
    const length = 120;
    const turn = CROSS_LOOKBACK_BARS;
    const packet = only(
      makeTickerPacket("MU", {
        technical: flatTechnical(),
        history: makeHistory("MU", length, (index) =>
          index < length - turn ? 300 + index : 300 + (length - turn) - (index - (length - turn)) * 30,
        ),
      }),
    );
    expect(kindsFor(packet, "MU")).toContain("macd-bear-cross");
  });

  it("stays quiet on a straight ramp with no cross in the window", () => {
    const packet = only(
      makeTickerPacket("MU", { technical: flatTechnical(), history: makeHistory("MU", 120, (i) => 300 + i) }),
    );
    const kinds = kindsFor(packet, "MU");
    expect(kinds).not.toContain("macd-bull-cross");
    expect(kinds).not.toContain("macd-bear-cross");
  });

  it("stays quiet when there are too few bars to seed the MACD", () => {
    const packet = only(
      makeTickerPacket("MU", { technical: flatTechnical(), history: makeHistory("MU", 10, (i) => 300 + i) }),
    );
    expect(kindsFor(packet, "MU")).toEqual([]);
  });
});

describe("computeSignals SMA breaks", () => {
  const flatTechnical = (overrides = {}) =>
    makeTechnical("MU", { rsi14: 50, high52w: 1e6, low52w: 0, ...overrides });

  it("reports a close crossing above SMA50 and SMA200 with the level as the value", () => {
    const length = 260;
    const turn = CROSS_LOOKBACK_BARS;
    const packet = only(
      makeTickerPacket("MU", {
        technical: flatTechnical({ sma50: 111, sma200: 222 }),
        history: makeHistory("MU", length, (index) =>
          index < length - turn ? 500 - index : 500 - (length - turn) + (index - (length - turn)) * 400,
        ),
      }),
    );
    const kinds = kindsFor(packet, "MU");
    expect(kinds).toContain("sma50-break-up");
    expect(kinds).toContain("sma200-break-up");
    const sma50 = computeSignals(packet).find((s) => s.kind === "sma50-break-up");
    expect(sma50?.value).toBe(111);
  });

  it("reports the break down on the mirror series", () => {
    const length = 260;
    const turn = CROSS_LOOKBACK_BARS;
    const packet = only(
      makeTickerPacket("MU", {
        technical: flatTechnical({ sma50: 111, sma200: 222 }),
        history: makeHistory("MU", length, (index) =>
          index < length - turn ? 500 + index : 500 + (length - turn) - (index - (length - turn)) * 400,
        ),
      }),
    );
    const kinds = kindsFor(packet, "MU");
    expect(kinds).toContain("sma50-break-down");
    expect(kinds).toContain("sma200-break-down");
  });
});

describe("computeSignals 52-week proximity", () => {
  it("flags a close sitting within the proximity band of the 52-week high", () => {
    const high = 1000;
    const packet = only(
      makeTickerPacket("MU", {
        history: null,
        quote: makeQuote("MU", { price: high * (1 - RANGE_PROXIMITY_PCT / 100) }),
        technical: makeTechnical("MU", { rsi14: 50, high52w: high, low52w: 10 }),
      }),
    );
    const signal = computeSignals(packet).find((s) => s.kind === "52w-high");
    expect(signal?.value).toBe(high);
  });

  it("flags the 52-week low and leaves a mid-range close alone", () => {
    const low = 100;
    const at = only(
      makeTickerPacket("MU", {
        history: null,
        quote: makeQuote("MU", { price: low }),
        technical: makeTechnical("MU", { rsi14: 50, high52w: 1000, low52w: low }),
      }),
    );
    expect(kindsFor(at, "MU")).toEqual(["52w-low"]);
    const middle = only(
      makeTickerPacket("MU", {
        history: null,
        quote: makeQuote("MU", { price: 500 }),
        technical: makeTechnical("MU", { rsi14: 50, high52w: 1000, low52w: low }),
      }),
    );
    expect(kindsFor(middle, "MU")).toEqual([]);
  });
});

describe("computeSignals unusual move", () => {
  /** A quiet 1% ramp, then one last bar that jumps by `jumpPct`. */
  function quietThenJump(length: number, jumpPct: number) {
    return (index: number): number => {
      const quiet = 100 * 1.01 ** index;
      return index === length - 1 ? (100 * 1.01 ** (index - 1) * (100 + jumpPct)) / 100 : quiet;
    };
  }

  it("flags a last bar far above the recent average absolute move", () => {
    const length = UNUSUAL_MOVE_WINDOW_BARS + 40;
    const packet = only(
      makeTickerPacket("MU", {
        technical: makeTechnical("MU", { rsi14: 50, high52w: 1e6, low52w: 0 }),
        history: makeHistory("MU", length, quietThenJump(length, UNUSUAL_MOVE_MULTIPLE * 5)),
      }),
    );
    const signal = computeSignals(packet).find((s) => s.kind === "unusual-move");
    expect(signal).toBeDefined();
    expect(signal?.value).toBeCloseTo(UNUSUAL_MOVE_MULTIPLE * 5, 6);
  });

  it("leaves a steady ramp alone", () => {
    const length = UNUSUAL_MOVE_WINDOW_BARS + 40;
    const packet = only(
      makeTickerPacket("MU", {
        technical: makeTechnical("MU", { rsi14: 50, high52w: 1e6, low52w: 0 }),
        history: makeHistory("MU", length, (index) => 100 * 1.01 ** index),
      }),
    );
    expect(kindsFor(packet, "MU")).not.toContain("unusual-move");
  });

  it("stays quiet without a full window of bars", () => {
    const packet = only(
      makeTickerPacket("MU", {
        technical: makeTechnical("MU", { rsi14: 50, high52w: 1e6, low52w: 0 }),
        history: makeHistory("MU", UNUSUAL_MOVE_WINDOW_BARS, (index) => 100 * 1.01 ** index),
      }),
    );
    expect(kindsFor(packet, "MU")).not.toContain("unusual-move");
  });
});

describe("computeSignals output shape", () => {
  const packet = only(
    makeTickerPacket("ZZZ", { technical: makeTechnical("ZZZ", { rsi14: 80 }), history: null }),
    makeTickerPacket("AAA", { technical: makeTechnical("AAA", { rsi14: 10 }), history: null }),
  );

  it("orders by the packet's ticker order, then by the signal-kind order", () => {
    expect(computeSignals(packet).map((s) => s.ticker)).toEqual(["ZZZ", "AAA"]);
    const many = only(
      makeTickerPacket("MU", {
        history: null,
        quote: makeQuote("MU", { price: 1000 }),
        technical: makeTechnical("MU", { rsi14: 90, high52w: 1000, low52w: 10 }),
      }),
    );
    const kinds = computeSignals(many).map((s) => s.kind);
    const order = kinds.map((kind) => MARKET_SIGNAL_KINDS.indexOf(kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(kinds).toEqual(["rsi-overbought", "52w-high"]);
  });

  it("is pure: the same packet gives the same rows and the packet is untouched", () => {
    const snapshot = JSON.stringify(packet);
    expect(computeSignals(packet)).toEqual(computeSignals(packet));
    expect(JSON.stringify(packet)).toBe(snapshot);
  });

  it("emits rows the schema accepts, with short finite notes", () => {
    for (const signal of computeSignals(packet)) {
      expect(marketSignalSchema.parse(signal)).toEqual(signal);
      expect(Number.isFinite(signal.value)).toBe(true);
      expect(signal.note.trim().length).toBeGreaterThan(5);
      expect(signal.note.length).toBeLessThanOrEqual(SIGNAL_NOTE_MAX);
    }
  });
});
