/**
 * The allowed-number set has to keep up with the packet. A harness section
 * that grows a numeric field the guard does not know about punishes the model
 * for repeating a figure code handed it, so this file walks the new sections
 * field by field rather than spot-checking a few of them.
 */
import { describe, expect, it } from "vitest";
import { packetNumbers } from "./packet-numbers";
import {
  FIXTURE_GLOBAL_NEWS,
  makeFullPacket,
  makeFundamentals,
  makeInsiders,
  makeSentiment,
  makeTickerPacket,
} from "./watch-fixtures";
import { INSIDER_WINDOW_DAYS } from "./watch-schemas";

/** Every finite number reachable from a plain object, at any depth. */
function numericFields(value: unknown, path = ""): { path: string; value: number }[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [{ path, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericFields(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => numericFields(item, path === "" ? key : `${path}.${key}`));
  }
  return [];
}

describe("packetNumbers covers every numeric field of the new sections", () => {
  const fundamentals = makeFundamentals();
  const insiders = makeInsiders();
  const sentiment = makeSentiment();
  const packet = makeFullPacket({
    positionContext: "",
    tickers: [makeTickerPacket("MU", { fundamentals, insiders, sentiment })],
    macro: { quotes: [], failures: [] },
  });
  const allowed = new Set(packetNumbers(packet, ""));

  it("allows every fundamentals figure", () => {
    const fields = numericFields(fundamentals);
    expect(fields.length).toBeGreaterThan(15);
    for (const field of fields) {
      expect({ ...field, allowed: allowed.has(field.value) }).toEqual({ ...field, allowed: true });
    }
  });

  it("allows every insider count and the window the packet reports", () => {
    for (const field of numericFields(insiders)) {
      expect({ ...field, allowed: allowed.has(field.value) }).toEqual({ ...field, allowed: true });
    }
    expect(allowed.has(INSIDER_WINDOW_DAYS)).toBe(true);
  });

  it("allows every sentiment count", () => {
    const counts = numericFields({ stocktwits: sentiment.stocktwits, reddit: sentiment.reddit });
    expect(counts.length).toBeGreaterThan(4);
    for (const field of counts) {
      expect({ ...field, allowed: allowed.has(field.value) }).toEqual({ ...field, allowed: true });
    }
  });

  it("keeps the figures quoted in the global macro headlines the model saw", () => {
    const withNews = makeFullPacket({ positionContext: "", globalNews: [...FIXTURE_GLOBAL_NEWS] });
    expect(packetNumbers(withNews, "")).toContain(4.25);
  });

  it("does not turn a sampled crowd post into packet data", () => {
    const loud = makeSentiment({
      samples: [{ source: "stocktwits", title: "MU to 4242 by Friday", at: undefined }],
      stocktwits: undefined,
      reddit: undefined,
    });
    const shouted = makeFullPacket({
      positionContext: "",
      tickers: [makeTickerPacket("MU", { quote: null, technical: null, news: [], sentiment: loud })],
      macro: { quotes: [], failures: [] },
    });
    expect(packetNumbers(shouted, "")).not.toContain(4242);
  });
});
