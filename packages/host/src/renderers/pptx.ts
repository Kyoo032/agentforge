import PptxGenJS from "pptxgenjs";
import { resolvedProductName } from "@agentforge/core";
import type { FinanceReport, ReportChart } from "@agentforge/core/finance";
import { safeReportFilename } from "./cells";
import { REPORT_MIME, type RenderedFile, type ReportRenderer } from "./types";

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

/** Quiet-tool tokens, hex for Office. Same palette the workbook and the document use. */
const COLORS = {
  accent: "0F766E",
  text: "292929",
  text2: "5D5D5D",
  text3: "9E9E9E",
  bg: "F7F7F6",
  surface: "FFFFFF",
  good: "E7F4EC",
  watch: "FDF0D5",
  risk: "FBE4E2",
} as const;

const FONT = "Calibri";
const LAYOUT = { name: "AGENTFORGE_WIDE", width: 13.333, height: 7.5 } as const;
const CHART_BOX = { x: 0.8, y: 1.5, w: 11.7, h: 4.3 } as const;
const NOTE_BOX = { x: 0.8, y: 6.0, w: 11.7, h: 0.8 } as const;

function addChrome(pptx: PptxGenJS, slide: PptxSlide, fill: string, productName: string): void {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: fill } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: "100%", fill: { color: COLORS.accent } });
  slide.addText(productName, { x: 0.7, y: 7.12, w: 8, h: 0.24, fontSize: 11, fontFace: FONT, color: COLORS.text3 });
}

function addHeading(slide: PptxSlide, text: string): void {
  slide.addText(text, {
    x: 0.8,
    y: 0.45,
    w: 11.7,
    h: 0.8,
    fontSize: 24,
    fontFace: FONT,
    bold: true,
    color: COLORS.text,
  });
}

function addNote(slide: PptxSlide, note?: string): void {
  if (!note?.trim()) {
    return;
  }
  slide.addText(note.trim(), { ...NOTE_BOX, fontSize: 13, fontFace: FONT, color: COLORS.text2, valign: "top" });
}

function addTitleSlide(pptx: PptxGenJS, report: FinanceReport, productName: string): void {
  const slide = pptx.addSlide();
  addChrome(pptx, slide, COLORS.bg, productName);
  slide.addText(report.title, {
    x: 0.9,
    y: 2.5,
    w: 11.5,
    h: 1.8,
    fontSize: 34,
    fontFace: FONT,
    bold: true,
    color: COLORS.text,
    valign: "top",
  });
  if (report.subtitle) {
    slide.addText(report.subtitle, {
      x: 0.9,
      y: 4.3,
      w: 11.5,
      h: 0.6,
      fontSize: 16,
      fontFace: FONT,
      color: COLORS.text2,
    });
  }
}

/** Native, editable chart data: one entry per series, each over the report's own categories. */
function chartData(chart: ReportChart): { name: string; labels: string[]; values: number[] }[] {
  return chart.series.map((series) => ({
    name: series.name,
    labels: [...chart.categories],
    values: chart.categories.map((_category, index) => series.values[index] ?? 0),
  }));
}

function addNativeChart(pptx: PptxGenJS, slide: PptxSlide, chart: ReportChart): void {
  const type = chart.kind === "line" ? pptx.ChartType.line : pptx.ChartType.bar;
  slide.addChart(type, chartData(chart), {
    ...CHART_BOX,
    chartColors: [COLORS.accent, COLORS.text2, COLORS.text3],
    showLegend: chart.series.length > 1,
    legendPos: "b",
    showValue: false,
    catAxisLabelFontFace: FONT,
    valAxisLabelFontFace: FONT,
    catAxisLabelFontSize: 11,
    valAxisLabelFontSize: 11,
    barDir: chart.kind === "gauge" ? "bar" : "col",
  });
}

function heatColor(value: number, extreme: number): string {
  if (extreme === 0) {
    return COLORS.surface;
  }
  const share = value / extreme;
  if (share <= -0.34) {
    return COLORS.risk;
  }
  if (share >= 0.34) {
    return COLORS.good;
  }
  return COLORS.watch;
}

/** No reliable native heat map in Office XML, so a heat grid becomes a coloured table. */
function addHeatTable(slide: PptxSlide, chart: ReportChart): void {
  const numbers = chart.series.flatMap((series) => series.values.filter((value): value is number => value !== null));
  const extreme = Math.max(1, ...numbers.map((value) => Math.abs(value)));
  const header = ["", ...chart.categories].map((text) => ({
    text,
    options: { bold: true, fill: { color: COLORS.bg }, color: COLORS.text },
  }));
  const rows = chart.series.map((series) => [
    { text: series.name, options: { bold: true, fill: { color: COLORS.bg }, color: COLORS.text } },
    ...chart.categories.map((_category, index) => {
      const value = series.values[index] ?? null;
      return {
        text: value === null ? "" : String(value),
        options: { fill: { color: value === null ? COLORS.surface : heatColor(value, extreme) }, color: COLORS.text },
      };
    }),
  ]);
  slide.addTable([header, ...rows], {
    ...CHART_BOX,
    fontFace: FONT,
    fontSize: 12,
    border: { pt: 1, color: COLORS.bg },
  });
}

function addChartSlide(pptx: PptxGenJS, chart: ReportChart, productName: string): void {
  const slide = pptx.addSlide();
  addChrome(pptx, slide, COLORS.surface, productName);
  addHeading(slide, chart.title);
  if (chart.kind === "heat") {
    addHeatTable(slide, chart);
  } else {
    addNativeChart(pptx, slide, chart);
  }
  addNote(slide, chart.note);
}

function flagColor(level: FinanceReport["flags"][number]["level"]): string {
  return level === "risk" ? COLORS.risk : level === "watch" ? COLORS.watch : COLORS.good;
}

function addFlagsSlide(pptx: PptxGenJS, report: FinanceReport, productName: string): void {
  if (report.flags.length === 0) {
    return;
  }
  const slide = pptx.addSlide();
  addChrome(pptx, slide, COLORS.surface, productName);
  addHeading(slide, report.title);
  const rows = report.flags.map((flag) => [
    { text: flag.level, options: { bold: true, fill: { color: flagColor(flag.level) }, color: COLORS.text } },
    { text: flag.text, options: { color: COLORS.text2 } },
  ]);
  slide.addTable(rows, { ...CHART_BOX, fontFace: FONT, fontSize: 13, colW: [2.2, 9.5] });
}

/**
 * Title slide, one slide per chart with its guarded note, then the flags. 16:9, restrained, and
 * every line and bar chart is a native Office chart a reader can edit in place.
 */
export const renderPptx: ReportRenderer = async (report: FinanceReport): Promise<RenderedFile> => {
  const productName = resolvedProductName();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ ...LAYOUT });
  pptx.layout = LAYOUT.name;
  pptx.author = productName;
  pptx.title = report.title;

  addTitleSlide(pptx, report, productName);
  for (const chart of report.charts) {
    addChartSlide(pptx, chart, productName);
  }
  addFlagsSlide(pptx, report, productName);

  const buffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return {
    bytes: new Uint8Array(buffer),
    mime: REPORT_MIME.pptx,
    filename: safeReportFilename(report.title, "pptx"),
  };
};
