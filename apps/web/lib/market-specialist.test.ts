import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALISTS,
  defaultWatchPrompt,
  isDefaultWatchPrompt,
  isMarketSpecialist,
  nextPrompt,
  specialistHint,
  specialistLabel,
  specialistProviderIds,
  specialistProviders,
  specialistSourcesLine,
  specialistStarterTickers,
} from "./market-specialist";

describe("nextPrompt", () => {
  it("swaps an untouched default when the agent changes", () => {
    const prompt = defaultWatchPrompt("saham", "id");
    expect(nextPrompt({ prompt, specialist: "elliott-wave", language: "id" })).toBe(
      defaultWatchPrompt("elliott-wave", "id"),
    );
  });

  it("swaps an untouched default when the language changes", () => {
    const prompt = defaultWatchPrompt("gold", "id");
    expect(nextPrompt({ prompt, specialist: "gold", language: "en" })).toBe(defaultWatchPrompt("gold", "en"));
  });

  it("follows both axes at once", () => {
    const prompt = defaultWatchPrompt("saham", "id");
    expect(nextPrompt({ prompt, specialist: "crypto", language: "en" })).toBe(defaultWatchPrompt("crypto", "en"));
  });

  it("keeps a prompt the user wrote", () => {
    const mine = "Only tell me where the invalidation sits.";
    expect(nextPrompt({ prompt: mine, specialist: "news", language: "en" })).toBe(mine);
  });

  it("keeps a user prompt that merely starts with a default", () => {
    const mine = `${defaultWatchPrompt("saham", "id")} Tambahkan catatan likuiditas.`;
    expect(nextPrompt({ prompt: mine, specialist: "forex", language: "id" })).toBe(mine);
  });

  it("refills an emptied box with the current agent's default", () => {
    expect(nextPrompt({ prompt: "   ", specialist: "summary", language: "en" })).toBe(
      defaultWatchPrompt("summary", "en"),
    );
  });

  it("treats a retired default named by the caller as untouched", () => {
    const retired = "An instruction no catalog ships any more.";
    expect(nextPrompt({ prompt: retired, specialist: "scanner", language: "id", previousDefault: retired })).toBe(
      defaultWatchPrompt("scanner", "id"),
    );
  });

  it("ignores surrounding whitespace on a default", () => {
    const padded = `\n  ${defaultWatchPrompt("news", "en")}  \n`;
    expect(nextPrompt({ prompt: padded, specialist: "news", language: "id" })).toBe(defaultWatchPrompt("news", "id"));
  });
});

describe("isDefaultWatchPrompt", () => {
  it("recognises every shipped default on both axes", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      expect(isDefaultWatchPrompt(defaultWatchPrompt(specialist, "id"))).toBe(true);
      expect(isDefaultWatchPrompt(defaultWatchPrompt(specialist, "en"))).toBe(true);
    }
  });

  it("rejects free text", () => {
    expect(isDefaultWatchPrompt("write me something")).toBe(false);
    expect(isDefaultWatchPrompt("")).toBe(false);
  });
});

describe("specialist meta helpers", () => {
  it("labels and hints every agent in both locales", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      for (const locale of ["id", "en"] as const) {
        expect(specialistLabel(specialist, locale).trim().length).toBeGreaterThan(0);
        expect(specialistHint(specialist, locale).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("translates where the two locales differ", () => {
    expect(specialistLabel("gold", "id")).toBe("Emas & Mineral");
    expect(specialistLabel("gold", "en")).toBe("Gold & Minerals");
  });

  it("hands back a fresh starter list the caller may keep", () => {
    const first = specialistStarterTickers("elliott-wave");
    expect(first.length).toBeGreaterThan(0);
    first.push("XXXX");
    expect(specialistStarterTickers("elliott-wave")).not.toContain("XXXX");
  });

  it("starts the equities desk on a mixed-exchange list", () => {
    // The desk is general equities, not IDX-only: the starters have to carry
    // both an IDX name and a bare US symbol.
    const starters = specialistStarterTickers("saham");
    expect(starters).toContain("BBCA");
    expect(starters).toContain("NVDA");
    expect(new Set(starters).size).toBe(starters.length);
  });

  it("starts on saham and guards unknown ids", () => {
    expect(DEFAULT_MARKET_SPECIALIST).toBe("saham");
    expect(isMarketSpecialist("elliott-wave")).toBe(true);
    expect(isMarketSpecialist("nope")).toBe(false);
  });
});

describe("specialist source providers", () => {
  const EN = "Computed on device";

  it("names the providers a wave count reaches", () => {
    // quotes + history are Yahoo, swings are computed from those bars.
    expect(specialistProviders("elliott-wave", EN)).toEqual(["Yahoo Finance", EN]);
  });

  it("adds CoinGecko for the crypto desk and keeps the harness order", () => {
    // The crypto harness reads sentiment too, so the two crowd venues close the list.
    expect(specialistProviders("crypto", EN)).toEqual([
      "Yahoo Finance",
      "TradingView",
      "CoinGecko",
      "StockTwits",
      "Reddit",
    ]);
  });

  it("names the scanner's mix of fetched and computed sections", () => {
    expect(specialistProviders("scanner", EN)).toEqual(["Yahoo Finance", "TradingView", EN]);
  });

  it("dedupes a provider that backs several sections", () => {
    // saham fetches quotes, history, macro and headlines — all one provider.
    expect(specialistProviderIds("saham").filter((id) => id === "yahoo")).toHaveLength(1);
  });

  it("gives every agent at least one provider", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      expect(specialistProviders(specialist, EN).length, specialist).toBeGreaterThan(0);
    }
  });

  it("translates only the on-device label, never the vendor names", () => {
    const line = specialistSourcesLine({
      specialist: "scanner",
      prefix: "Sumber",
      computedLabel: "Dihitung di perangkat",
    });
    expect(line).toBe("Sumber: Yahoo Finance · TradingView · Dihitung di perangkat");
  });

  it("writes the English badge with the same separator", () => {
    expect(specialistSourcesLine({ specialist: "crypto", prefix: "Sources", computedLabel: EN })).toBe(
      "Sources: Yahoo Finance · TradingView · CoinGecko · StockTwits · Reddit",
    );
  });
});
