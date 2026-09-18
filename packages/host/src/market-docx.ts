/**
 * Market briefing -> DOCX. Title, the disclaimer under it, the generated /
 * clock line, the model's sections, the watchlist table, the macro table, one
 * table per ticker chart (DOCX has no SVG: the last CHART_POINTS_MAX points of
 * each series are written as rows, and a note says the studio draws the
 * line), the headlines, the sources, and the disclaimer again last.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun, type Table } from "docx";
import { resolvedProductName } from "@agentforge/core";
import { specialistLabel, type MarketBriefing } from "@agentforge/core/artifacts";
import { teamSectionHeadings, type TickerPacket } from "@agentforge/core/market";
import { docxTable, type DocxCell } from "./docx-table";

export const CHART_POINTS_MAX = 30;
export const CHART_NOTE = `Chart shown as a table (last ${CHART_POINTS_MAX} points); the studio draws the line chart.`;

const FONT = "Calibri";
const HEADING_COLOR = "1565C0";
const TITLE_COLOR = "0D2137";
const MUTED_COLOR = "555555";
const WATCHLIST_COLUMNS = [
  "Ticker",
  "Name",
  "Price",
  "Chg%",
  "Pre-mkt",
  "Pre%",
  "State",
  "TV rating",
  "RSI14",
  "SMA50",
  "SMA200",
] as const;
const MACRO_COLUMNS = ["Macro", "Symbol", "Level", "Chg%", "State"] as const;

/** Labels for the Team appendix. The five section headings inside it are core's. */
const TEAM_LABELS = {
  en: {
    team: "Team",
    confidence: "confidence",
    rebuttals: "Rebuttals",
    volatility: "Volatility",
    liquidity: "Liquidity",
  },
  id: {
    team: "Tim",
    confidence: "keyakinan",
    rebuttals: "Sanggahan",
    volatility: "Volatilitas",
    liquidity: "Likuiditas",
  },
} as const;

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "market-briefing"}.docx`;
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel], size: number): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, font: FONT, bold: true, size, color: HEADING_COLOR })],
  });
}

function plain(text: string, options: { italics?: boolean; color?: string; after?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: options.after ?? 200 },
    children: [new TextRun({ text, font: FONT, size: 22, italics: options.italics, color: options.color })],
  });
}

function bodyParagraphs(body: string): Paragraph[] {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return (blocks.length > 0 ? blocks : [body.trim()]).map((block) => plain(block));
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text, font: FONT, size: 22 })] });
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 160 } });
}

function pct(value: number | null): string {
  return value === null ? "" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clockLine(briefing: MarketBriefing): string {
  const { clock } = briefing.packet;
  const guarded =
    briefing.guardedSections > 0
      ? `${briefing.guardedSections} section${briefing.guardedSections === 1 ? "" : "s"} touched by the advice guard.`
      : null;
  return [
    `Agent: ${specialistLabel(briefing)}.`,
    `Generated ${briefing.generatedAt}. U.S. session: ${clock.usSession}.`,
    clock.note || null,
    guarded,
  ]
    .filter(Boolean)
    .join(" ");
}

function watchlistRow(ticker: TickerPacket): DocxCell[] {
  const q = ticker.quote;
  const t = ticker.technical;
  return [
    ticker.symbol.yahoo,
    ticker.symbol.name,
    q?.price ?? null,
    pct(q?.changePercent ?? null),
    q?.preMarketPrice ?? null,
    pct(q?.preMarketChangePercent ?? null),
    q?.marketState ?? "",
    t?.tradingview?.label ?? "",
    t?.rsi14 ?? null,
    t?.sma50 ?? null,
    t?.sma200 ?? null,
  ];
}

function watchlistBlock(briefing: MarketBriefing, locale?: string): Array<Paragraph | Table> {
  const rows = briefing.packet.tickers.map(watchlistRow);
  return [heading("Watchlist", HeadingLevel.HEADING_1, 28), docxTable(WATCHLIST_COLUMNS, rows, locale), spacer()];
}

function macroBlock(briefing: MarketBriefing, locale?: string): Array<Paragraph | Table> {
  const quotes = briefing.packet.macro.quotes;
  if (quotes.length === 0) {
    return [];
  }
  const rows = quotes.map((q) => [q.label || q.symbol, q.symbol, q.price, pct(q.changePercent), q.marketState]);
  return [heading("Macro", HeadingLevel.HEADING_1, 28), docxTable(MACRO_COLUMNS, rows, locale), spacer()];
}

function chartBlock(ticker: TickerPacket, locale?: string): Array<Paragraph | Table> {
  const chart = ticker.chart;
  if (!chart) {
    return [];
  }
  const from = Math.max(0, chart.x.values.length - CHART_POINTS_MAX);
  const columns = [chart.x.label || "date", ...chart.series.map((series) => series.name)];
  const rows = chart.x.values
    .slice(from)
    .map((x, offset) => [x, ...chart.series.map((series) => series.values[from + offset] ?? null)]);
  return [
    heading(chart.title || `${ticker.symbol.yahoo} chart`, HeadingLevel.HEADING_2, 24),
    plain(CHART_NOTE, { italics: true, color: MUTED_COLOR }),
    docxTable(columns, rows, locale),
    spacer(),
  ];
}

function chartsBlock(briefing: MarketBriefing, locale?: string): Array<Paragraph | Table> {
  const blocks = briefing.packet.tickers.flatMap((ticker) => chartBlock(ticker, locale));
  return blocks.length > 0 ? [heading("Charts", HeadingLevel.HEADING_1, 28), ...blocks] : [];
}

function headlinesBlock(briefing: MarketBriefing): Paragraph[] {
  const perTicker = briefing.packet.tickers.flatMap((ticker) => {
    const items = ticker.news.filter((item) => !item.injectionSuspect);
    if (items.length === 0) {
      return [];
    }
    return [
      heading(`${ticker.symbol.yahoo} headlines`, HeadingLevel.HEADING_2, 24),
      ...items.map((item) =>
        bullet(
          `${item.title} — ${item.publisher || item.ref.source}${item.publishedAt ? ` (${item.publishedAt.slice(0, 10)})` : ""}: ${item.link}`,
        ),
      ),
    ];
  });
  return perTicker.length > 0 ? [heading("Headlines", HeadingLevel.HEADING_1, 28), ...perTicker] : [];
}

/**
 * The team's own notes after the sections: each analyst with its confidence,
 * both sides of the debate, and the three risk lenses. Empty for a quick
 * briefing. The notes were guarded when they were stored, so this is rendering
 * only — nothing here re-guards them.
 */
function teamBlock(briefing: MarketBriefing): Paragraph[] {
  const notes = briefing.team;
  if (!notes) {
    return [];
  }
  const [analystNotes, bullHeading, bearHeading, riskHeading] = teamSectionHeadings(briefing.language);
  const labels = briefing.language === "en" ? TEAM_LABELS.en : TEAM_LABELS.id;
  const side = (title: string | undefined, entry: NonNullable<MarketBriefing["team"]>["bull"]): Paragraph[] => [
    heading(title ?? entry.stance, HeadingLevel.HEADING_2, 24),
    plain(entry.thesis),
    ...entry.points.map(bullet),
    ...(entry.rebuttals.length > 0 ? [plain(`${labels.rebuttals}:`), ...entry.rebuttals.map(bullet)] : []),
  ];
  return [
    heading(labels.team, HeadingLevel.HEADING_1, 28),
    heading(analystNotes ?? "Analyst notes", HeadingLevel.HEADING_2, 24),
    ...notes.analysts.flatMap((note) => [
      plain(`${note.analyst} (${labels.confidence}: ${note.confidence})`, { after: 80 }),
      plain(note.summary),
      ...note.keyPoints.map(bullet),
    ]),
    ...side(bullHeading, notes.bull),
    ...side(bearHeading, notes.bear),
    heading(riskHeading ?? "Risk read", HeadingLevel.HEADING_2, 24),
    ...notes.risk.lenses.flatMap((lens) => [plain(`${lens.lens} — ${lens.view}`), ...lens.keyRisks.map(bullet)]),
    plain(`${labels.volatility}: ${notes.risk.volatility}`),
    plain(`${labels.liquidity}: ${notes.risk.liquidity}`),
    spacer(),
  ];
}

function sourcesBlock(briefing: MarketBriefing): Paragraph[] {
  const lines = briefing.sources.map(
    (source) => `${source.label}: ${source.url} (observed ${source.observedAt.slice(0, 10)})`,
  );
  return [
    heading("Sources", HeadingLevel.HEADING_1, 28),
    ...(lines.length > 0 ? lines.map(bullet) : [bullet("None recorded.")]),
  ];
}

/** Disclaimer on the first page under the title and again as the last paragraph. */
export async function buildMarketBriefingDocx(
  briefing: MarketBriefing,
  locale?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
      children: [new TextRun({ text: briefing.title, font: FONT, bold: true, size: 48, color: TITLE_COLOR })],
    }),
    plain(briefing.disclaimer, { italics: true, color: MUTED_COLOR }),
    plain(clockLine(briefing), { color: MUTED_COLOR }),
    ...briefing.sections.flatMap((section) => [
      heading(section.heading, HeadingLevel.HEADING_1, 28),
      ...bodyParagraphs(section.body),
    ]),
    ...watchlistBlock(briefing, locale),
    ...macroBlock(briefing, locale),
    ...chartsBlock(briefing, locale),
    ...headlinesBlock(briefing),
    ...teamBlock(briefing),
    ...sourcesBlock(briefing),
    plain(briefing.disclaimer, { italics: true, color: MUTED_COLOR, after: 0 }),
  ];
  const doc = new Document({ creator: resolvedProductName(), title: briefing.title, sections: [{ children }] });
  return { buffer: await Packer.toBuffer(doc), filename: safeFilename(briefing.title) };
}
