"use client";

import { BAR_COLORS, type RangeUsage } from "./usage-panel";

type Props = {
  buckets: RangeUsage["buckets"];
  productName?: string;
  minKeep?: number;
};

const CHART_W = 640;
const CHART_H = 220;
const PAD_L = 46;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 32;

export function trimLeadingEmptyBuckets<T extends { usd: number; models: unknown[] }>(
  buckets: T[],
  minKeep: number,
): T[] {
  if (buckets.length <= minKeep) {
    return buckets;
  }
  let first = 0;
  while (first < buckets.length - minKeep) {
    const bucket = buckets[first];
    if (!bucket || bucket.usd > 0 || bucket.models.length > 0) {
      break;
    }
    first += 1;
  }
  return buckets.slice(first);
}

function axisUsd(value: number): string {
  if (value <= 0) {
    return "$0";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  if (value < 1) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

/** Hand-rolled stacked bars by bucket × model. No chart library. */
export function UsageRangeChart({ buckets, productName = "DPSBuddy", minKeep = 7 }: Props) {
  const visible = trimLeadingEmptyBuckets(buckets, minKeep);
  const hasSpend = visible.some((bucket) => bucket.usd > 0 || bucket.models.some((row) => row.usd > 0));
  const hasRuns = visible.some((bucket) => bucket.models.length > 0);
  if (visible.length === 0 || (!hasSpend && !hasRuns)) {
    return (
      <p className="mt-4 text-sm text-[var(--text-2)]" data-testid="usage-range-empty">
        No {productName} runs in this range.
      </p>
    );
  }
  if (!hasSpend && hasRuns) {
    return (
      <p className="mt-4 text-sm text-[var(--text-2)]" data-testid="usage-range-empty">
        Runs in this range are not priced yet.
      </p>
    );
  }

  const modelOrder: string[] = [];
  for (const bucket of visible) {
    for (const row of bucket.models) {
      if (!modelOrder.includes(row.model)) {
        modelOrder.push(row.model);
      }
    }
  }

  const maxUsd = visible.reduce((max, bucket) => Math.max(max, bucket.usd), 0);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const gap = visible.length > 10 ? 6 : 10;
  const barW = Math.max(10, (plotW - gap * (visible.length - 1)) / visible.length);
  const ticks = [maxUsd, maxUsd / 2, 0];
  const labelEvery = visible.length > 8 ? 2 : 1;

  return (
    <div className="mt-3 overflow-x-auto" data-testid="usage-range-chart">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full text-[var(--text)]"
        role="img"
        aria-label="Spend by model over time"
      >
        {ticks.map((tick) => {
          const y = PAD_T + (maxUsd > 0 ? (1 - tick / maxUsd) * plotH : plotH);
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={PAD_L}
                x2={CHART_W - PAD_R}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.12"
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-current"
                style={{ fontSize: 12, opacity: 0.55 }}
              >
                {axisUsd(tick)}
              </text>
            </g>
          );
        })}
        {visible.map((bucket, i) => {
          const x = PAD_L + i * (barW + gap);
          let y = PAD_T + plotH;
          const segments = modelOrder
            .map((model) => {
              const row = bucket.models.find((item) => item.model === model);
              return { model, usd: row?.usd ?? 0 };
            })
            .filter((seg) => seg.usd > 0);
          const showLabel = i === visible.length - 1 || i % labelEvery === 0;

          return (
            <g key={bucket.key}>
              <line
                x1={x + barW / 2}
                x2={x + barW / 2}
                y1={PAD_T + plotH}
                y2={PAD_T + plotH + 4}
                stroke="currentColor"
                strokeOpacity="0.25"
              />
              {segments.map((seg) => {
                const h = maxUsd > 0 ? (seg.usd / maxUsd) * plotH : 0;
                y -= h;
                const colorIndex = modelOrder.indexOf(seg.model);
                return (
                  <rect
                    key={seg.model}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, 0)}
                    fill={BAR_COLORS[colorIndex % BAR_COLORS.length]}
                  >
                    <title>
                      {bucket.label}: {seg.model} · ${seg.usd.toFixed(4)}
                    </title>
                  </rect>
                );
              })}
              {showLabel ? (
                <text
                  x={x + barW / 2}
                  y={CHART_H - 10}
                  textAnchor="middle"
                  className="fill-current"
                  style={{ fontSize: 12, opacity: 0.6 }}
                >
                  {bucket.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {modelOrder.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-2)]">
          {modelOrder.map((model, index) => (
            <li key={model} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }}
                aria-hidden
              />
              <span className="truncate" title={model}>
                {model}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
