"use client";

import { useState } from "react";
import type { DataChart } from "@agentforge/core/artifacts";
import {
  CHART_RANGES,
  CHART_RANGE_DEFAULT,
  buildRangeChart,
  type ChartRangeId,
  type PriceHistory,
} from "@agentforge/core/market";
import { SvgChart } from "@/components/svg-chart";

type Props = {
  /** Daily bars; the chart is cut to the chosen range on the client. */
  history: PriceHistory | null;
  /** Server-built chart for packets that carry no bars (older artifacts). */
  fallback?: DataChart | null;
  symbol: string;
  testId?: string;
};

const RANGE_BUTTON =
  "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 aria-pressed:border-navy aria-pressed:bg-navy aria-pressed:text-paper border-mist text-ink/70 hover:bg-mist/40";

/** Close, SMA50, and SMA200 over 1M to 2Y, with the range switch above the plot. */
export function MarketPriceChart({ history, fallback = null, symbol, testId }: Props) {
  const [range, setRange] = useState<ChartRangeId>(CHART_RANGE_DEFAULT);
  const hasBars = history !== null && history.bars.length > 0;
  const chart = hasBars ? buildRangeChart(history, range, `${symbol} close`) : fallback;
  if (!chart) {
    return (
      <p className="rounded-xl border border-dashed border-mist p-4 text-sm text-ink/55" data-testid={testId}>
        No price history to chart.
      </p>
    );
  }
  return (
    <div>
      {hasBars ? (
        <div
          role="group"
          aria-label="Chart range"
          className="mb-2 flex flex-wrap gap-1"
          data-testid={testId ? `${testId}-ranges` : undefined}
        >
          {CHART_RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={RANGE_BUTTON}
              aria-pressed={range === item.id}
              onClick={() => setRange(item.id)}
              data-range={item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <SvgChart chart={chart} testId={testId} zeroBaseline={false} />
    </div>
  );
}
