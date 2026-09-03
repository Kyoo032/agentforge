"use client";

import { BAR_COLORS, type RangeUsage } from "./usage-panel";

type Props = {
  buckets: RangeUsage["buckets"];
  productName?: string;
};

const CHART_W = 560;
const CHART_H = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 36;

/** Hand-rolled stacked bars by bucket × model. No chart library. */
export function UsageRangeChart({ buckets, productName = "Agentforge" }: Props) {
  const hasSpend = buckets.some((b) => b.usd > 0 || b.models.some((m) => m.usd > 0));
  if (buckets.length === 0 || !hasSpend) {
    return (
      <p className="mt-4 text-sm text-ink/50" data-testid="usage-range-empty">
        No {productName} runs in this range.
      </p>
    );
  }

  const modelOrder: string[] = [];
  for (const bucket of buckets) {
    for (const row of bucket.models) {
      if (!modelOrder.includes(row.model)) {
        modelOrder.push(row.model);
      }
    }
  }

  const maxUsd = buckets.reduce((max, b) => Math.max(max, b.usd), 0);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const gap = 8;
  const barW = Math.max(12, (plotW - gap * (buckets.length - 1)) / buckets.length);

  return (
    <div className="mt-4 overflow-x-auto" data-testid="usage-range-chart">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full max-w-xl text-ink"
        role="img"
        aria-label="Spend by model over time"
      >
        {buckets.map((bucket, i) => {
          const x = PAD_L + i * (barW + gap);
          let y = PAD_T + plotH;
          const segments = modelOrder
            .map((model) => {
              const row = bucket.models.find((m) => m.model === model);
              return { model, usd: row?.usd ?? 0 };
            })
            .filter((s) => s.usd > 0);

          return (
            <g key={bucket.key}>
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
              <text
                x={x + barW / 2}
                y={CHART_H - 12}
                textAnchor="middle"
                className="fill-ink/60"
                style={{ fontSize: 11 }}
              >
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>
      {modelOrder.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/70">
          {modelOrder.map((model, index) => (
            <li key={model} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
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
