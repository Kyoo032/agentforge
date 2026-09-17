import { describe, expect, it } from "vitest";
import { scanForAdvice } from "./advice-guard";
import { harnessFor } from "./harness";
import {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  defaultWatchPrompt,
  isMarketSpecialist,
  specialistSystemRules,
  type MarketSpecialist,
} from "./specialists";
import { isValidTicker, toYahooSymbol } from "./symbols";
import { WATCHLIST_MAX } from "./watch-schemas";

const LANGUAGES = ["id", "en"] as const;

describe("MARKET_SPECIALISTS", () => {
  it("names the eleven agents the owner asked for, in a stable order", () => {
    expect(MARKET_SPECIALISTS).toEqual([
      "saham",
      "forex",
      "gold",
      "crypto",
      "commodities",
      "indices",
      "sector-rotation",
      "scanner",
      "summary",
      "elliott-wave",
      "news",
    ]);
    expect(new Set(MARKET_SPECIALISTS).size).toBe(MARKET_SPECIALISTS.length);
  });

  it("defaults to saham", () => {
    expect(DEFAULT_MARKET_SPECIALIST).toBe("saham");
    expect(MARKET_SPECIALISTS).toContain(DEFAULT_MARKET_SPECIALIST);
  });

  it("recognises its own ids and nothing else", () => {
    for (const id of MARKET_SPECIALISTS) {
      expect(isMarketSpecialist(id)).toBe(true);
    }
    for (const value of ["", "SAHAM", "stocks", "elliott", null, undefined, 3, {}]) {
      expect(isMarketSpecialist(value)).toBe(false);
    }
  });
});

describe("MARKET_SPECIALIST_META", () => {
  it("has an entry per id, keyed by its own id", () => {
    expect(Object.keys(MARKET_SPECIALIST_META).sort()).toEqual([...MARKET_SPECIALISTS].sort());
    for (const id of MARKET_SPECIALISTS) {
      expect(MARKET_SPECIALIST_META[id].id).toBe(id);
    }
  });

  it("carries the owner's labels in both languages", () => {
    expect(MARKET_SPECIALIST_META.saham.label).toEqual({ id: "Saham", en: "Stocks" });
    expect(MARKET_SPECIALIST_META.forex.label).toEqual({ id: "Forex", en: "Forex" });
    expect(MARKET_SPECIALIST_META.gold.label).toEqual({ id: "Emas & Mineral", en: "Gold & Minerals" });
    expect(MARKET_SPECIALIST_META.crypto.label).toEqual({ id: "Kripto", en: "Crypto" });
    expect(MARKET_SPECIALIST_META.commodities.label).toEqual({ id: "Komoditas", en: "Commodities" });
    expect(MARKET_SPECIALIST_META.indices.label).toEqual({ id: "Indeks Global", en: "Global Indices" });
    expect(MARKET_SPECIALIST_META["sector-rotation"].label).toEqual({
      id: "Rotasi Sektor",
      en: "Sector Rotation",
    });
    expect(MARKET_SPECIALIST_META.scanner.label).toEqual({ id: "Market Scanner", en: "Market Scanner" });
    expect(MARKET_SPECIALIST_META.summary.label).toEqual({ id: "Ringkasan Pasar", en: "Market Summary" });
    expect(MARKET_SPECIALIST_META["elliott-wave"].label).toEqual({
      id: "Elliott Wave Count",
      en: "Elliott Wave Count",
    });
    expect(MARKET_SPECIALIST_META.news.label).toEqual({ id: "Agregator Berita", en: "News Aggregator" });
  });

  it("gives every agent a hint and a real default prompt in both languages", () => {
    for (const id of MARKET_SPECIALISTS) {
      const meta = MARKET_SPECIALIST_META[id];
      for (const language of LANGUAGES) {
        expect(meta.hint[language].trim().length).toBeGreaterThan(10);
        expect(meta.defaultPrompt[language].trim().length).toBeGreaterThan(80);
        expect(scanForAdvice(meta.defaultPrompt[language])).toEqual([]);
        expect(scanForAdvice(meta.hint[language])).toEqual([]);
      }
      // The Indonesian prompt is written in Indonesian, not a copy of the English one.
      expect(meta.defaultPrompt.id).not.toBe(meta.defaultPrompt.en);
      expect(meta.label.id.length).toBeGreaterThan(0);
      expect(meta.label.en.length).toBeGreaterThan(0);
    }
  });

  it("gives every agent a distinct focus", () => {
    const focuses = MARKET_SPECIALISTS.map((id) => MARKET_SPECIALIST_META[id].focus);
    expect(new Set(focuses).size).toBe(MARKET_SPECIALISTS.length);
  });

  it("starts every agent with tickers the symbol resolver accepts", () => {
    for (const id of MARKET_SPECIALISTS) {
      const starters = MARKET_SPECIALIST_META[id].starterTickers;
      expect(starters.length).toBeGreaterThan(0);
      expect(starters.length).toBeLessThanOrEqual(WATCHLIST_MAX);
      expect(new Set(starters).size).toBe(starters.length);
      for (const ticker of starters) {
        expect(isValidTicker(ticker)).toBe(true);
        expect(toYahooSymbol(ticker)).not.toBe("");
      }
    }
  });

  it("resolves the IDX starters to their .JK symbols and keeps the venue symbols verbatim", () => {
    // The equities desk is not one exchange: the IDX names resolve to `.JK`
    // through the universe, the US large caps stay bare so Yahoo reads them on
    // NYSE/Nasdaq.
    expect(MARKET_SPECIALIST_META.saham.starterTickers.map(toYahooSymbol)).toEqual([
      "BBCA.JK",
      "BBRI.JK",
      "TLKM.JK",
      "ASII.JK",
      "NVDA",
      "AAPL",
      "MSFT",
      "TSLA",
    ]);
    expect(MARKET_SPECIALIST_META.news.starterTickers.map(toYahooSymbol)).toEqual([
      "BBCA.JK",
      "BBRI.JK",
      "BMRI.JK",
      "TLKM.JK",
      "ASII.JK",
    ]);
    expect(MARKET_SPECIALIST_META.crypto.starterTickers.map(toYahooSymbol)).toEqual([
      "BTC-USD",
      "ETH-USD",
      "SOL-USD",
      "BNB-USD",
    ]);
    expect(MARKET_SPECIALIST_META.forex.starterTickers).toContain("DX-Y.NYB");
    // The metals desk starts on three metals futures, four Indonesian miners, and the US miner ETF.
    expect(MARKET_SPECIALIST_META.gold.starterTickers.map(toYahooSymbol)).toEqual([
      "GC=F",
      "SI=F",
      "HG=F",
      "ANTM.JK",
      "INCO.JK",
      "TINS.JK",
      "MDKA.JK",
      "GDX",
    ]);
    expect(MARKET_SPECIALIST_META.commodities.starterTickers).toEqual(["CL=F", "NG=F", "HG=F", "SI=F"]);
    expect(MARKET_SPECIALIST_META.indices.starterTickers).toContain("^N225");
    expect(MARKET_SPECIALIST_META.indices.starterTickers).toContain("^HSI");
    // IDX sector proxies resolve through the universe; the US sector ETFs stay bare symbols.
    expect(MARKET_SPECIALIST_META["sector-rotation"].starterTickers.map(toYahooSymbol)).toEqual([
      "BBCA.JK",
      "BBRI.JK",
      "TLKM.JK",
      "ASII.JK",
      "UNVR.JK",
      "ICBP.JK",
      "ANTM.JK",
      "ADRO.JK",
      "PGAS.JK",
      "XLK",
      "XLF",
      "XLE",
      "XLV",
    ]);
    expect(MARKET_SPECIALIST_META.summary.starterTickers).toContain("^JKSE");
    expect(MARKET_SPECIALIST_META["elliott-wave"].starterTickers).toContain("^JKSE");
  });
});

describe("specialistSystemRules", () => {
  it("returns non-empty bullet rules for every agent in both languages", () => {
    for (const id of MARKET_SPECIALISTS) {
      for (const language of LANGUAGES) {
        const rules = specialistSystemRules(id, language);
        expect(rules.length).toBeGreaterThan(2);
        for (const rule of rules) {
          expect(rule.startsWith("- ")).toBe(true);
          expect(rule.trim().length).toBeGreaterThan(12);
        }
      }
    }
  });

  it("never issues an imperative directive", () => {
    for (const id of MARKET_SPECIALISTS) {
      for (const language of LANGUAGES) {
        expect(scanForAdvice(specialistSystemRules(id, language))).toEqual([]);
      }
    }
  });

  it("gives each agent its own behaviour", () => {
    const joined = (id: MarketSpecialist) => specialistSystemRules(id, "en").join("\n");
    expect(joined("saham")).toMatch(/IDX|LQ45|ARA|ARB/);
    // The equities desk reads any exchange, and never carries one venue's
    // mechanics onto a name listed somewhere else.
    for (const language of LANGUAGES) {
      const text = specialistSystemRules("saham", language).join(" | ");
      // The exchange comes off the packet, and every venue the resolver can
      // suffix is named with its own currency and its own clock.
      expect(text, language).toMatch(/SESSIONS/);
      expect(text, language).toMatch(/\.JK/);
      expect(text, language).toMatch(/NYSE/);
      expect(text, language).toMatch(/Nasdaq/);
      expect(text, language).toMatch(/\.L\b/);
      expect(text, language).toMatch(/\.T\b/);
      expect(text, language).toMatch(/\.HK/);
      expect(text, language).toMatch(/\.SI/);
      expect(text, language).toMatch(/IDR/);
      expect(text, language).toMatch(/USD/);
    }
    expect(joined("forex")).toMatch(/DXY|pair|rate differential/i);
    expect(joined("gold")).toMatch(/real yield|XAU|miner/i);
    expect(joined("gold")).toMatch(/METALS CONTEXT/);
    expect(joined("crypto")).toMatch(/24\/7|dominance|funding/i);
    expect(joined("commodities")).toMatch(/futures curve|contango|supply and demand/i);
    expect(joined("commodities")).toMatch(/CPO|coal|USD\/IDR/i);
    expect(joined("indices")).toMatch(/session relay|Asia|cash indices/i);
    expect(joined("indices")).toMatch(/breadth/i);
    expect(joined("sector-rotation")).toMatch(/leaders|laggards|relative performance/i);
    expect(joined("sector-rotation")).toMatch(/never state portfolio weights|allocation/i);
    expect(joined("sector-rotation")).toMatch(/ROTATION table/);
    expect(joined("scanner")).toMatch(/table/i);
    expect(joined("scanner")).toMatch(/SIGNALS table/);
    expect(joined("crypto")).toMatch(/CRYPTO GLOBAL/);
    expect(joined("summary")).toMatch(/SESSIONS block/);
    expect(joined("summary")).toMatch(/one page|session|indices/i);
    expect(joined("elliott-wave")).toMatch(/wave|invalidation|alternate/i);
    expect(joined("news")).toMatch(/publisher|headline|stale/i);
    const all = MARKET_SPECIALISTS.map((id) => joined(id));
    expect(new Set(all).size).toBe(MARKET_SPECIALISTS.length);
  });

  it("tells the scanner and the wave counter to stay inside the packet", () => {
    expect(specialistSystemRules("scanner", "id").join("\n")).toMatch(/packet/i);
    expect(specialistSystemRules("elliott-wave", "id").join("\n")).toMatch(/swing/i);
    expect(specialistSystemRules("elliott-wave", "en").join("\n")).toMatch(/swing/i);
  });
});

describe("defaultWatchPrompt", () => {
  it("is the meta prompt for that agent and language", () => {
    for (const id of MARKET_SPECIALISTS) {
      for (const language of LANGUAGES) {
        expect(defaultWatchPrompt(id, language)).toBe(MARKET_SPECIALIST_META[id].defaultPrompt[language]);
      }
    }
  });

  it("keeps the length budget placeholder so the studio can substitute it", () => {
    for (const id of MARKET_SPECIALISTS) {
      for (const language of LANGUAGES) {
        expect(defaultWatchPrompt(id, language)).toContain("{maxChars}");
      }
    }
  });
});

describe("specialist rules name the code-computed sections", () => {
  it("points each desk at the section the harness computes for it, in both languages", () => {
    const joined = (id: MarketSpecialist, language: "id" | "en") => specialistSystemRules(id, language).join(" | ");
    for (const language of LANGUAGES) {
      expect(joined("scanner", language)).toMatch(/SIGNALS/);
      expect(joined("sector-rotation", language)).toMatch(/ROTATION/);
      expect(joined("crypto", language)).toMatch(/CRYPTO GLOBAL/);
      expect(joined("gold", language)).toMatch(/METALS CONTEXT/);
      expect(joined("summary", language)).toMatch(/SESSIONS/);
    }
  });

  it("only names a section its own harness actually renders", () => {
    const markers: Readonly<Record<string, RegExp>> = {
      signals: /SIGNALS/,
      rotation: /ROTATION/,
      crypto: /CRYPTO GLOBAL/,
      metals: /METALS CONTEXT/,
      sessions: /SESSIONS/,
    };
    for (const id of MARKET_SPECIALISTS) {
      const order: readonly string[] = harnessFor(id).packetOrder;
      const text = LANGUAGES.flatMap((language) => specialistSystemRules(id, language)).join(" | ");
      for (const [source, marker] of Object.entries(markers)) {
        if (marker.test(text)) {
          expect({ id, source }).toEqual({ id, source: order.includes(source) ? source : "NOT IN packetOrder" });
        }
      }
    }
  });
});
