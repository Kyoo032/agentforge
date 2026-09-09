import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MARKET_DISCLAIMER } from "@agentforge/core/market";
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
    { language: "en", generatedAt: FIXTURE_NOW.toISOString() },
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
