"use client";

import type { ReactNode } from "react";
import type { ReportChart, ReportFlagLevel } from "@agentforge/core/finance";
import { t } from "@/lib/i18n";
import { FINANCE_CHART_LAYOUT } from "@/lib/finance-chart-geometry";
import {
  chartPalette,
  formatTick,
  plotArea,
  truncateLabel,
  type PlotArea,
  type XTick,
  type YTick,
} from "@/lib/chart-scale";

export const layout = FINANCE_CHART_LAYOUT;
export const plot = plotArea(layout);

export const AXIS_OPACITY = 0.15;
export const TEXT_OPACITY = 0.6;
export const TICK_FONT = 12;
const ROTATE_FROM = 8;

/** Only tokens: a chart must read the same in light and dark without a second palette. */
export const LEVEL_COLOR: Record<ReportFlagLevel, string> = {
  good: "var(--ok)",
  watch: "var(--text-3)",
  risk: "var(--danger)",
};

export function seriesColor(index: number): string {
  return chartPalette(index);
}

type FrameProps = {
  chart: ReportChart;
  testId?: string;
  children: ReactNode;
};

/** Caption, accessible SVG, note and legend: the shell every Finance chart shares. */
export function ChartFrame({ chart, testId, children }: FrameProps) {
  return (
    <figure
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[var(--text)]"
      data-testid={testId ?? `finance-chart-${chart.id}`}
    >
      <figcaption className="text-sm font-medium text-[var(--text)]">{chart.title}</figcaption>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label={t("finance.charts.alt", { title: chart.title, kind: t(`finance.charts.kind.${chart.kind}`) })}
      >
        <title>{chart.title}</title>
        {children}
      </svg>
      {chart.note ? <figcaption className="mt-2 text-xs text-[var(--text-2)]">{chart.note}</figcaption> : null}
      {chart.series.length > 1 ? <Legend names={chart.series.map((series) => series.name)} /> : null}
    </figure>
  );
}

export function YAxis({ ticks, area = plot }: { ticks: YTick[]; area?: PlotArea }) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick.label}>
          <line x1={area.x0} x2={area.x1} y1={tick.y} y2={tick.y} stroke="currentColor" strokeOpacity={AXIS_OPACITY} />
          <text
            x={area.x0 - 6}
            y={tick.y + 3}
            textAnchor="end"
            fill="currentColor"
            style={{ fontSize: TICK_FONT, opacity: TEXT_OPACITY }}
          >
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function XLabels({ labels, area = plot }: { labels: XTick[]; area?: PlotArea }) {
  const rotate = labels.length > ROTATE_FROM;
  const y = area.y1 + 14;
  return (
    <g>
      <line x1={area.x0} x2={area.x1} y1={area.y1} y2={area.y1} stroke="currentColor" strokeOpacity={AXIS_OPACITY} />
      {labels.map((label, index) => (
        <text
          key={`${label.label}-${index}`}
          x={label.x}
          y={y}
          textAnchor={rotate ? "end" : "middle"}
          transform={rotate ? `rotate(-30 ${label.x} ${y})` : undefined}
          fill="currentColor"
          style={{ fontSize: TICK_FONT, opacity: TEXT_OPACITY }}
        >
          <title>{label.label}</title>
          {truncateLabel(label.label)}
        </text>
      ))}
    </g>
  );
}

export function Legend({ names }: { names: string[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-2)]">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: seriesColor(index) }}
            aria-hidden
          />
          <span className="truncate" title={name}>
            {name}
          </span>
        </li>
      ))}
    </ul>
  );
}

export { formatTick };
