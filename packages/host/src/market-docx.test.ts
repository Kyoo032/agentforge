import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MARKET_SPECIALIST_META, MARKET_DISCLAIMER } from "@agentforge/core/market";
import {
  FIXTURE_HEADLINE,
  FIXTURE_NEWS_URL,
  FIXTURE_NOW,
  history,
  packet,
  tickerMu,
} from "./market/__fixtures__/watch";
import { buildMarketBriefing } from "./market-briefing-build";
import { CHART_NOTE, CHART_POINTS_MAX, buildMarketBriefingDocx } from "./market-docx";

function decodeXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function documentText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return decodeXml((await zip.file("word/document.xml")?.async("string")) ?? "");
}

describe("buildMarketBriefingDocx", () => {
  const { briefing } = buildMarketBriefing(
    {
      title: "Memory names lead the open",
      sections: [
        { heading: "TL;DR", body: "MU trades at 1000.26.\n\nConfidence medium." },
        { heading: "Ranking", body: "1. MU 2. BBCA.JK" },
      ],
    },
    packet(),
    { language: "en", generatedAt: FIXTURE_NOW.toISOString(), specialist: "gold" },
  );

  it("is a zip whose document carries title, disclaimer twice, sections, tables, charts, headlines, and sources", async () => {
    const { buffer, filename } = await buildMarketBriefingDocx(briefing);
    expect(filename).toBe("Memory-names-lead-the-open.docx");
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const text = await documentText(buffer);
    expect(text).toContain("Memory names lead the open");
    expect(count(text, MARKET_DISCLAIMER)).toBe(2);
    expect(text).toContain(`Generated ${FIXTURE_NOW.toISOString()}. U.S. session: pre.`);
    expect(text).toContain("TL;DR");
    expect(text).toContain("MU trades at 1000.26.");
    expect(text).toContain("Confidence medium.");
    expect(text).toContain("Ranking");

    expect(text).toContain("Watchlist");
    expect(text).toContain("Micron Technology, Inc.");
    expect(text).toContain("Bank Central Asia Tbk");
    expect(text).toContain("Neutral");
    expect(text).toContain("+0.52%");

    expect(text).toContain("Macro");
    expect(text).toContain("S&P 500 futures");
    expect(text).toContain("USD/IDR");

    expect(text).toContain("Charts");
    expect(text).toContain("MU close");
    expect(text).toContain("BBCA.JK close");
    expect(count(text, CHART_NOTE)).toBe(2);
    expect(text).toContain("2026-09-01");
    expect(text).toContain("2026-09-06");

    expect(text).toContain("Headlines");
    expect(text).toContain("MU headlines");
    expect(text).toContain(FIXTURE_HEADLINE);
    expect(text).toContain("Reuters");
    expect(text).toContain(FIXTURE_NEWS_URL);

    expect(text).toContain("Sources");
    expect(text).toContain("https://www.tradingview.com/symbols/NASDAQ-MU/technicals/");
    expect(text.lastIndexOf(MARKET_DISCLAIMER)).toBeGreaterThan(text.lastIndexOf("Sources"));
  });

  it("writes only the last CHART_POINTS_MAX chart points and skips empty macro, chart, and headline blocks", async () => {
    const closes = Array.from({ length: CHART_POINTS_MAX + 10 }, (_, index) => 900 + index);
    const long = history("MU", closes);
    const wide = buildMarketBriefing(
      { title: "Long", sections: [{ heading: "TL;DR", body: "Flat." }] },
      packet({
        tickers: [
          tickerMu({
            history: long,
            chart: {
              type: "line",
              title: "MU close",
              x: { label: "date", values: long.bars.map((bar) => bar.date) },
              series: [{ name: "close", values: closes }],
            },
            news: [],
          }),
        ],
        macro: { quotes: [], failures: ["macro: offline"] },
      }),
      { language: "id", generatedAt: FIXTURE_NOW.toISOString() },
    );
    const text = await documentText((await buildMarketBriefingDocx(wide.briefing)).buffer);
    expect(text).not.toContain(long.bars[0]?.date ?? "never");
    expect(text).toContain(long.bars[long.bars.length - CHART_POINTS_MAX]?.date ?? "never");
    expect(text).toContain(long.bars.at(-1)?.date ?? "never");
    expect(text).not.toContain("Macro");
    expect(text).not.toContain("Headlines");
    expect(count(text, MARKET_DISCLAIMER)).toBe(2);
  });
});

describe("buildMarketBriefingDocx specialist", () => {
  it("names the agent under the title in the briefing's language", async () => {
    const english = buildMarketBriefing(
      { title: "Gold desk", sections: [{ heading: "TL;DR", body: "Gold held its range." }] },
      packet(),
      { language: "en", generatedAt: FIXTURE_NOW.toISOString(), specialist: "gold" },
    ).briefing;
    const text = await documentText((await buildMarketBriefingDocx(english)).buffer);
    expect(text).toContain(MARKET_SPECIALIST_META.gold.label.en);

    const indonesian = buildMarketBriefing(
      { title: "Meja emas", sections: [{ heading: "TL;DR", body: "Emas bertahan." }] },
      packet(),
      { language: "id", generatedAt: FIXTURE_NOW.toISOString(), specialist: "gold" },
    ).briefing;
    const idText = await documentText((await buildMarketBriefingDocx(indonesian)).buffer);
    expect(idText).toContain(MARKET_SPECIALIST_META.gold.label.id);
  });
});

describe("buildMarketBriefingDocx team appendix", () => {
  const notes = {
    analysts: [
      {
        analyst: "technical" as const,
        summary: "Price sits above SMA50.",
        keyPoints: ["RSI14 is 57.66"],
        confidence: "medium" as const,
      },
      { analyst: "news" as const, summary: "<unavailable>", keyPoints: [], confidence: "low" as const },
    ],
    bull: {
      stance: "bull" as const,
      thesis: "Supply is tight.",
      points: ["HBM sold out"],
      rebuttals: ["The bear over-reads the cycle"],
    },
    bear: { stance: "bear" as const, thesis: "Margins compress.", points: ["Pricing rolls over"], rebuttals: [] },
    risk: {
      lenses: [
        { lens: "aggressive" as const, view: "Wide drawdown is tolerable.", keyRisks: ["Gap risk"] },
        { lens: "neutral" as const, view: "Balanced.", keyRisks: [] },
        { lens: "conservative" as const, view: "Drawdown dominates.", keyRisks: ["Cycle turn"] },
      ],
      volatility: "The range is wide.",
      liquidity: "Volume thins outside the session.",
    },
    rounds: 1 as const,
  };

  const { briefing } = buildMarketBriefing(
    { title: "Team briefing", sections: [{ heading: "Analyst notes", body: "Four seats reported." }] },
    packet(),
    { language: "en", generatedAt: FIXTURE_NOW.toISOString(), specialist: "saham", depth: "team", team: notes },
  );

  it("writes the analyst notes, both sides of the debate and the three lenses after the sections", async () => {
    const text = await documentText((await buildMarketBriefingDocx(briefing)).buffer);

    expect(text).toContain("Team");
    expect(text).toContain("technical (confidence: medium)");
    expect(text).toContain("Price sits above SMA50.");
    expect(text).toContain("RSI14 is 57.66");
    // A seat that came back empty is shown as empty, never dropped.
    expect(text).toContain("news (confidence: low)");
    expect(text).toContain("<unavailable>");
    expect(text).toContain("Bull case");
    expect(text).toContain("Supply is tight.");
    expect(text).toContain("Rebuttals:");
    expect(text).toContain("Bear case");
    expect(text).toContain("Risk read");
    for (const lens of ["aggressive", "neutral", "conservative"]) {
      expect(text).toContain(lens);
    }
    expect(text).toContain("Volatility: The range is wide.");
    expect(text).toContain("Liquidity: Volume thins outside the session.");
    // Still after the sections and still before the closing disclaimer.
    expect(text.indexOf("technical (confidence: medium)")).toBeGreaterThan(text.indexOf("Four seats reported."));
    expect(text.lastIndexOf(MARKET_DISCLAIMER)).toBeGreaterThan(text.indexOf("Liquidity:"));
  });

  it("writes nothing at all for a quick briefing", async () => {
    const { briefing: quick } = buildMarketBriefing(
      { title: "Quick briefing", sections: [{ heading: "TL;DR", body: "MU at 1000.26." }] },
      packet(),
      { language: "en", generatedAt: FIXTURE_NOW.toISOString(), specialist: "saham" },
    );
    const text = await documentText((await buildMarketBriefingDocx(quick)).buffer);
    expect(text).not.toContain("Risk read");
    expect(text).not.toContain("confidence:");
  });
});
