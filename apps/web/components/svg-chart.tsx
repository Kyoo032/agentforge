"use client";

import type { DataChart } from "@agentforge/core/artifacts";
import {
  DEFAULT_CHART_LAYOUT,
  type PlotArea,
  type XTick,
  type YTick,
  buildBarLayout,
  buildLineLayout,
  buildScatterLayout,
  chartPalette,
  formatTick,
  plotArea,
  truncateLabel,
} from "@/lib/chart-scale";

type Props = {
  chart: DataChart;
  testId?: string;
  /** Anchor the y axis at zero (default). Price charts pass false so the plot follows the data. */
  zeroBaseline?: boolean;
};

const ROTATE_FROM = 8;
/** Beyond this many points a marker per point is clutter; the line alone reads better. */
const MAX_MARKER_POINTS = 40;
const TICK_FONT = 10;
const LABEL_FONT = 11;
const LINE_WIDTH = 2;
const MARKER_RADIUS = 4;
const AXIS_OPACITY = 0.15;
const TEXT_OPACITY = 0.6;

const layout = DEFAULT_CHART_LAYOUT;
const plot = plotArea(layout);

export function SvgChart({ chart, testId, zeroBaseline = true }: Props) {
  const caption = chart.title || `${chart.type} chart`;
  return (
    <figure className="rounded-xl border border-mist bg-paper p-4 text-ink" data-testid={testId}>
      <figcaption className="text-sm font-semibold text-ink">
        {caption}
        {chart.x.label ? <span className="ml-2 font-normal text-ink/55">by {chart.x.label}</span> : null}
      </figcaption>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label={`${caption}, ${chart.type} chart`}
      >
        <ChartBody chart={chart} zeroBaseline={zeroBaseline} />
      </svg>
      {chart.series.length > 1 ? <Legend names={chart.series.map((series) => series.name)} /> : null}
    </figure>
  );
}

function ChartBody({ chart, zeroBaseline }: { chart: DataChart; zeroBaseline: boolean }) {
  if (chart.type === "bar") {
    return <BarChart chart={chart} />;
  }
  if (chart.type === "line") {
    return <LineChart chart={chart} zeroBaseline={zeroBaseline} />;
  }
  return <ScatterChart chart={chart} />;
}

function BarChart({ chart }: { chart: DataChart }) {
  const { bars, ticks, xLabels } = buildBarLayout(chart, layout);
  return (
    <>
      <YAxis ticks={ticks} plot={plot} />
      <XLabels labels={xLabels} plot={plot} />
      {bars.map((bar) => (
        <rect
          key={`${bar.label}-${bar.seriesIndex}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={2}
          fill={chartPalette(bar.seriesIndex)}
        >
          <title>{`${chart.series[bar.seriesIndex]?.name ?? ""}: ${formatTick(bar.value)} (${bar.label})`}</title>
        </rect>
      ))}
    </>
  );
}

function LineChart({ chart, zeroBaseline }: { chart: DataChart; zeroBaseline: boolean }) {
  const { lines, ticks, xLabels } = buildLineLayout(chart, layout, zeroBaseline);
  return (
    <>
      <YAxis ticks={ticks} plot={plot} />
      <XLabels labels={xLabels} plot={plot} />
      {lines.map((line) => {
        const name = chart.series[line.seriesIndex]?.name ?? "";
        const color = chartPalette(line.seriesIndex);
        return (
          <g key={name || line.seriesIndex}>
            {line.path ? (
              <path
                d={line.path}
                fill="none"
                stroke={color}
                strokeWidth={LINE_WIDTH}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {line.points.length <= MAX_MARKER_POINTS
              ? line.points.map((point) => (
                  <circle
                    key={point.label}
                    cx={point.x}
                    cy={point.y}
                    r={MARKER_RADIUS}
                    fill={color}
                    stroke="var(--color-paper)"
                    strokeWidth={2}
                  >
                    <title>{`${name}: ${formatTick(point.value)} (${point.label})`}</title>
                  </circle>
                ))
              : null}
          </g>
        );
      })}
    </>
  );
}

function ScatterChart({ chart }: { chart: DataChart }) {
  const { points, xTicks, yTicks } = buildScatterLayout(chart, layout);
  return (
    <>
      <YAxis ticks={yTicks} plot={plot} />
      <XLabels labels={xTicks} plot={plot} />
      {points.map((point, index) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: scatter points have no stable id
          key={index}
          cx={point.x}
          cy={point.y}
          r={MARKER_RADIUS}
          fill={chartPalette(point.seriesIndex)}
          fillOpacity={0.85}
          stroke="var(--color-paper)"
          strokeWidth={2}
        >
          <title>{`${chart.series[point.seriesIndex]?.name ?? ""}: ${formatTick(point.xValue)}, ${formatTick(point.yValue)}`}</title>
        </circle>
      ))}
    </>
  );
}

function YAxis({ ticks, plot: area }: { ticks: YTick[]; plot: PlotArea }) {
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

function XLabels({ labels, plot: area }: { labels: XTick[]; plot: PlotArea }) {
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
          style={{ fontSize: LABEL_FONT, opacity: TEXT_OPACITY }}
        >
          <title>{label.label}</title>
          {truncateLabel(label.label)}
        </text>
      ))}
    </g>
  );
}

function Legend({ names }: { names: string[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink/70">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: chartPalette(index) }}
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
