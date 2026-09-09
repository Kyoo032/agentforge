import { describe, expect, it } from "vitest";
import {
  ADVICE_MARKER,
  ADVICE_PATTERN,
  AdviceLeakError,
  KEY_MARKER,
  assertNoAdvice,
  guardAdviceInText,
  scanForAdvice,
} from "./advice-guard";

/**
 * Market Watch v2: only imperative directives are forbidden. Ranking, sentiment,
 * price targets from the user's own position context, and "signals to watch"
 * are the briefing's job and must pass.
 */
const ADVICE_PHRASINGS = [
  "Beli sekarang sebelum naik",
  "Jual sekarang sebelum koreksi",
  "Belilah saham ini",
  "Juallah sebelum turun",
  "Buy now while it's cheap",
  "Sell now, ask questions later",
  "Masuk sekarang sebelum terlambat",
  "Akumulasi sekarang selagi murah",
  "You should buy before the dividend",
  "You should sell into strength",
  "Kamu harus beli hari ini",
  "Anda harus jual sebelum earnings",
  "Harus beli sekarang",
  "Harus jual sekarang juga",
  "BELI SEKARANG! Harga sudah murah",
  "It is time to buy now",
  "YOU SHOULD SELL",
];

const DESCRIPTIVE_PHRASINGS = [
  "Ranking hari ini: MU paling bullish, INTC paling bearish",
  "Target $1,000 sudah tercapai",
  "Support di $886, resistance $1,000",
  "TradingView: STRONG_BUY (0.56)",
  "Cut loss level yang wajar di bawah $860 menurut setup teknikal",
  "Take profit zone according to analysts is $1,050",
  "sentimen bearish untuk pembukaan",
  "Revenue FY2025 grew 12.4% YoY (Yahoo Finance, observed 2026-09-09).",
  "RSI(14) was 71.3 on 2026-09-08",
  "Harga ditutup di Rp 9.850",
  "Manajemen membeli kembali saham",
  "Saham dijual oleh pemegang saham utama",
  "The stock closed at 9,850 on 2026-09-08",
  "TradingView 1d summary: 14 BUY, 8 NEUTRAL, 4 SELL",
  "Strong buy rating from 14 of 26 indicators (TradingView)",
  "Hold dulu is not a directive we make; the setup is described only",
  "Target harga analis konsensus di Rp 12.000 (Yahoo Finance)",
  "Entry dividen tercatat pada laporan keuangan",
  "Profit-taking pressure was noted by Kontan",
  "Signals to watch: a close above $1,000 or a break below $886",
];

const SUBSTRING_WORDS = ["membeli", "pembelian", "dijual", "penjualan", "terjual", "belikan", "jualan"];

const MIN_ADVICE_CASES = 12;
const MIN_DESCRIPTIVE_CASES = 15;

function leak(payload: unknown, masked?: ReadonlySet<string>): AdviceLeakError {
  try {
    assertNoAdvice(payload, masked);
  } catch (error) {
    if (error instanceof AdviceLeakError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected AdviceLeakError");
}

describe("ADVICE_PATTERN", () => {
  it("meets the definition-of-done case counts", () => {
    expect(ADVICE_PHRASINGS.length).toBeGreaterThanOrEqual(MIN_ADVICE_CASES);
    expect(DESCRIPTIVE_PHRASINGS.length).toBeGreaterThanOrEqual(MIN_DESCRIPTIVE_CASES);
  });

  it("is case-insensitive and not global (stateless)", () => {
    expect(ADVICE_PATTERN.flags).toContain("i");
    expect(ADVICE_PATTERN.flags).not.toContain("g");
  });

  it("no longer forbids v1 descriptive market vocabulary", () => {
    for (const phrase of ["target harga", "take profit", "cut loss", "hold dulu", "strong buy", "strong sell"]) {
      expect(ADVICE_PATTERN.test(phrase)).toBe(false);
    }
  });

  it("does not match bare beli / jual", () => {
    expect(ADVICE_PATTERN.test("beli")).toBe(false);
    expect(ADVICE_PATTERN.test("jual")).toBe(false);
    expect(ADVICE_PATTERN.test("Rekomendasi: beli")).toBe(false);
  });
});

describe("assertNoAdvice", () => {
  it.each(ADVICE_PHRASINGS)("raises on imperative phrasing: %s", (phrase) => {
    const error = leak({ bull: [{ text: phrase }] });
    expect(error.path).toBe("bull[0].text");
    expect(error.match.length).toBeGreaterThan(0);
    expect(error.message).toContain("bull[0].text");
  });

  it.each(DESCRIPTIVE_PHRASINGS)("passes descriptive phrasing: %s", (phrase) => {
    expect(() => assertNoAdvice({ bear: [{ text: phrase }] })).not.toThrow();
  });

  it.each(SUBSTRING_WORDS)("does not match the substring inside %s", (word) => {
    expect(() => assertNoAdvice({ text: `${word} sekarang` })).not.toThrow();
  });

  it("scans dict keys with the $key suffix", () => {
    const error = leak({ indicators: { "buy now": 1.0 } });
    expect(error.path).toBe(`indicators.buy now.${KEY_MARKER}`);
  });

  it("scans nested lists and dicts", () => {
    const error = leak({ a: [1, null, { b: [[{ c: "Beli sekarang di 10.000" }]] }] });
    expect(error.path).toBe("a[2].b[0][0].c");
    expect(error.match.toLowerCase()).toBe("beli sekarang");
  });

  it("ignores non-string scalars", () => {
    expect(() => assertNoAdvice({ n: 1, f: 2.5, b: true, none: null, u: undefined })).not.toThrow();
  });

  it("skips an exact masked path only", () => {
    const masked = new Set(["quote.label"]);
    expect(() => assertNoAdvice({ quote: { label: "buy now" } }, masked)).not.toThrow();
    expect(() => assertNoAdvice({ x: { quote: { label: "buy now" } } }, masked)).toThrow(AdviceLeakError);
  });

  it("still raises for the same phrase outside the masked path", () => {
    const masked = new Set(["quote.label"]);
    const payload = { quote: { label: "buy now" }, bull: [{ text: "beli sekarang" }] };
    const error = leak(payload, masked);
    expect(error.path).toBe("bull[0].text");
    expect(error.match.toLowerCase()).toBe("beli sekarang");
  });

  it("masks a key marker path but still scans the value under it", () => {
    const masked = new Set([`countsByGrade.sell now.${KEY_MARKER}`]);
    expect(() => assertNoAdvice({ countsByGrade: { "sell now": 0 } }, masked)).not.toThrow();
    const error = leak({ countsByGrade: { "sell now": "beli sekarang" } }, masked);
    expect(error.path).toBe("countsByGrade.sell now");
  });

  it("has no name-based exemption on plain objects", () => {
    expect(leak({ tradingview_summary: { label: "buy now" } }).path).toBe("tradingview_summary.label");
  });

  it("never redacts: the payload is untouched after a throw", () => {
    const payload = { text: "sell now" };
    expect(() => assertNoAdvice(payload)).toThrow(AdviceLeakError);
    expect(payload).toEqual({ text: "sell now" });
  });
});

describe("scanForAdvice", () => {
  it("reports every match without throwing", () => {
    const payload = { x: "Beli sekarang", y: ["ok", "sell now"], z: 3 };
    expect(scanForAdvice(payload)).toEqual([
      { path: "x", match: "Beli sekarang" },
      { path: "y[1]", match: "sell now" },
    ]);
  });

  it("returns an empty list for a clean payload", () => {
    expect(scanForAdvice({ text: "Revenue grew 12% YoY; ranking: MU paling bullish" })).toEqual([]);
  });
});

describe("guardAdviceInText", () => {
  it("replaces only the offending sentence and counts it", () => {
    const text = "Revenue grew 12.4% YoY. Beli sekarang sebelum naik. Volume was 12.3 million shares.";
    const result = guardAdviceInText(text);
    expect(result.replaced).toBe(1);
    expect(result.text).toBe(`Revenue grew 12.4% YoY. ${ADVICE_MARKER} Volume was 12.3 million shares.`);
  });

  it("handles multiple sentences and paragraphs", () => {
    const text = "First is fine.\n\nYou should buy the dip! Second is fine.\nJual sekarang";
    const result = guardAdviceInText(text);
    expect(result.replaced).toBe(2);
    expect(result.text).toBe(`First is fine.\n\n${ADVICE_MARKER} Second is fine.\n${ADVICE_MARKER}`);
  });

  it("keeps a ranking with targets and key levels intact", () => {
    const text =
      "Ranking hari ini: MU paling bullish. Target $1,000 sudah tercapai. Support di $886, resistance $1,000.";
    expect(guardAdviceInText(text)).toEqual({ text, replaced: 0 });
  });

  it("does not split on decimal points inside numbers", () => {
    const result = guardAdviceInText("Harga ditutup di Rp 9.850 pada 2026-09-08. Volume naik.");
    expect(result.replaced).toBe(0);
    expect(result.text).toBe("Harga ditutup di Rp 9.850 pada 2026-09-08. Volume naik.");
  });

  it("returns the same content for clean text and never mutates the input", () => {
    const text = "Dividend yield stood at 3.1% (trailing).";
    const result = guardAdviceInText(text);
    expect(result).toEqual({ text, replaced: 0 });
  });

  it("handles empty text", () => {
    expect(guardAdviceInText("")).toEqual({ text: "", replaced: 0 });
  });
});
