/**
 * Market Watch briefing artifact: the model's sections over a fetched data
 * packet, plus the packet itself so every chart, quote, and headline the reader
 * sees is the one the model saw. Markdown is the interchange format.
 */
import { z } from "zod";
import {
  BRIEFING_SECTIONS_MAX,
  BRIEFING_SOURCES_MAX,
  marketWatchPacketSchema,
  type TickerPacket,
} from "../market/watch-schemas";
import { DEFAULT_MARKET_SPECIALIST, MARKET_SPECIALISTS, MARKET_SPECIALIST_META } from "../market/specialists";
import { DEFAULT_MARKET_DEPTH, MARKET_DEPTHS, teamNotesSchema } from "../market/team";
import { httpUrlSchema } from "../market/schemas";
import { markdownTable } from "./markdown-table";

export const briefingSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});
export type BriefingSection = z.infer<typeof briefingSectionSchema>;

export const briefingSourceSchema = z.object({
  label: z.string().min(1),
  url: httpUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
});
export type BriefingSource = z.infer<typeof briefingSourceSchema>;

export const marketBriefingSchema = z.object({
  title: z.string().min(1),
  language: z.enum(["id", "en"]).default("id"),
  /** The named Market agent that wrote it; a rewrite reuses the same rules. */
  specialist: z.enum(MARKET_SPECIALISTS).default(DEFAULT_MARKET_SPECIALIST),
  /** How it was written: one pass (`quick`) or the analyst team (`team`). */
  depth: z.enum(MARKET_DEPTHS).default(DEFAULT_MARKET_DEPTH),
  generatedAt: z.string().datetime({ offset: true }),
  sections: z.array(briefingSectionSchema).min(1).max(BRIEFING_SECTIONS_MAX),
  packet: marketWatchPacketSchema,
  sources: z.array(briefingSourceSchema).max(BRIEFING_SOURCES_MAX).default([]),
  /**
   * What the team produced, stored only for a `team` run and only after the
   * advice and number guards have been run over every free-text field.
   */
  team: teamNotesSchema.optional(),
  /** Sections the advice guard touched. */
  guardedSections: z.number().int().nonnegative().default(0),
  disclaimer: z.string().min(1),
});
export type MarketBriefing = z.infer<typeof marketBriefingSchema>;

function pct(value: number | null): string {
  return value === null ? "" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? "" : value.toFixed(digits);
}

function watchlistTable(tickers: TickerPacket[]): string {
  const columns = ["Ticker", "Price", "Chg%", "Pre-mkt", "Pre%", "State", "TV rating", "RSI14", "vs SMA200"];
  const rows = tickers.map((t) => {
    const q = t.quote;
    const tech = t.technical;
    const vsSma =
      q?.price !== null && q?.price !== undefined && tech?.sma200
        ? pct(((q.price - tech.sma200) / tech.sma200) * 100)
        : "";
    return [
      t.symbol.yahoo,
      num(q?.price ?? null),
      pct(q?.changePercent ?? null),
      num(q?.preMarketPrice ?? null),
      pct(q?.preMarketChangePercent ?? null),
      q?.marketState ?? "",
      tech?.tradingview?.label ?? "",
      num(tech?.rsi14 ?? null, 1),
      vsSma,
    ];
  });
  return markdownTable(columns, rows);
}

function macroTable(briefing: MarketBriefing): string {
  const rows = briefing.packet.macro.quotes.map((q) => [q.label || q.symbol, num(q.price), pct(q.changePercent)]);
  return markdownTable(["Macro", "Level", "Chg%"], rows);
}

function chartBlock(t: TickerPacket): string[] {
  if (!t.chart) return [];
  const columns = [t.chart.x.label || "date", ...t.chart.series.map((s) => s.name)];
  const rows = t.chart.x.values.map((x, i) => [x, ...t.chart!.series.map((s) => s.values[i] ?? null)]);
  return [`### ${t.chart.title || t.symbol.yahoo}`, "", markdownTable(columns, rows), ""];
}

function newsBlock(t: TickerPacket): string[] {
  const items = t.news.filter((n) => !n.injectionSuspect);
  if (items.length === 0) return [];
  return [
    `### ${t.symbol.yahoo} headlines`,
    "",
    ...items.map((n) => `- [${n.title}](${n.link}) — ${n.publisher || n.ref.source}`),
    "",
  ];
}

/** The agent's name in the briefing's own language, for the line under the title. */
export function specialistLabel(briefing: Pick<MarketBriefing, "specialist" | "language">): string {
  const meta = MARKET_SPECIALIST_META[briefing.specialist] ?? MARKET_SPECIALIST_META[DEFAULT_MARKET_SPECIALIST];
  return briefing.language === "en" ? meta.label.en : meta.label.id;
}

export function marketBriefingToMarkdown(briefing: MarketBriefing): string {
  const lines: string[] = [
    `# ${briefing.title}`,
    "",
    `Agent: ${specialistLabel(briefing)} · generated ${briefing.generatedAt} · session: ${briefing.packet.clock.usSession}`,
  ];
  if (briefing.packet.clock.note) lines.push("", `> ${briefing.packet.clock.note}`);
  lines.push("");
  for (const section of briefing.sections) {
    lines.push(`## ${section.heading}`, "", section.body, "");
  }
  lines.push("## Watchlist data", "", watchlistTable(briefing.packet.tickers), "");
  if (briefing.packet.macro.quotes.length > 0) lines.push("## Macro data", "", macroTable(briefing), "");
  const charts = briefing.packet.tickers.flatMap(chartBlock);
  if (charts.length > 0) lines.push("## Charts", "", ...charts);
  const news = briefing.packet.tickers.flatMap(newsBlock);
  if (news.length > 0) lines.push("## Headlines", "", ...news);
  if (briefing.sources.length > 0) {
    lines.push(
      "## Sources",
      "",
      ...briefing.sources.map((s) => `- [${s.label}](${s.url}) (observed ${s.observedAt})`),
      "",
    );
  }
  lines.push(`> ${briefing.disclaimer}`, "");
  return lines.join("\n");
}
