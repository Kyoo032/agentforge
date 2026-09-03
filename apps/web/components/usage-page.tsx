"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  BAR_COLORS,
  KeyQuotaMeter,
  thisKeyLine,
  tokenLabel,
  type RangeUsage,
  type UsageRange,
} from "./usage-panel";
import { UsageRangeChart } from "./usage-range-chart";
import { useProductBrand } from "@/lib/product-brand";

const RANGES: Array<{ id: UsageRange; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

function emptyDesk(): RangeUsage["desk"] {
  return {
    usd: 0,
    display: "$0.00",
    unknownCount: 0,
    pricedCount: 0,
    modelCount: 0,
    byModel: [],
  };
}

function parseUsage(payload: unknown, range: UsageRange): RangeUsage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const row = payload as Partial<RangeUsage>;
  const thisKey = row.thisKey;
  if (!thisKey || typeof thisKey !== "object" || !("status" in thisKey)) {
    return null;
  }
  return {
    range: row.range === "week" || row.range === "month" || row.range === "day" ? row.range : range,
    thisKey: thisKey as RangeUsage["thisKey"],
    desk: row.desk && typeof row.desk === "object" ? { ...emptyDesk(), ...row.desk, byModel: row.desk.byModel ?? [] } : emptyDesk(),
    buckets: Array.isArray(row.buckets) ? row.buckets : [],
  };
}

export function UsagePage() {
  const { productName, gatewayName } = useProductBrand();
  const [range, setRange] = useState<UsageRange>("day");
  const [usage, setUsage] = useState<RangeUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((nextRange: UsageRange) => {
    setLoading(true);
    setLoadError(null);
    void apiFetch(`/api/v1/usage?range=${nextRange}`)
      .then(async (res) => {
        if (!res.ok) {
          setUsage(null);
          setLoadError(res.status === 404 ? "Usage is not available yet." : `Could not load usage (${res.status}).`);
          return;
        }
        const payload: unknown = await res.json();
        const parsed = parseUsage(payload, nextRange);
        if (!parsed) {
          setUsage(null);
          setLoadError("Usage response was incomplete.");
          return;
        }
        setUsage(parsed);
      })
      .catch(() => {
        setUsage(null);
        setLoadError("Could not load usage.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const desk = usage?.desk ?? emptyDesk();
  const byModel = desk.byModel ?? [];
  const priced = byModel.filter((row) => row.usd > 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Usage</h1>
      <p className="mt-2 text-ink/60">This-key wallet and desk spend for the selected range.</p>

      <section className="mt-6 rounded-xl border border-mist bg-paper p-5">
        <p className="text-sm text-ink" data-testid="usage-this-key">
          This key: {loading && !usage ? "…" : thisKeyLine(usage)}
        </p>
        <KeyQuotaMeter usage={usage} />
        {loadError ? <p className="mt-2 text-sm text-ink/50">{loadError}</p> : null}

        <p className="mt-3 text-sm text-ink" data-testid="usage-desk-range">
          This desk (this range): {desk.display} · {desk.modelCount} model{desk.modelCount === 1 ? "" : "s"}
        </p>

        <div className="mt-4 flex flex-wrap gap-2" data-testid="usage-range" role="group" aria-label="Usage range">
          {RANGES.map((option) => {
            const active = range === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={
                  active
                    ? "rounded-md bg-navy px-3 py-1.5 text-sm text-white"
                    : "rounded-md border border-mist px-3 py-1.5 text-sm text-ink hover:bg-mist"
                }
                aria-pressed={active}
                data-testid={`usage-range-${option.id}`}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {loading && !usage ? (
          <p className="mt-4 text-sm text-ink/50">Loading…</p>
        ) : (
          <UsageRangeChart buckets={usage?.buckets ?? []} productName={productName} />
        )}

        <div className="mt-6" data-testid="usage-by-model">
          <p className="text-sm font-medium text-ink">Spend by model (this range)</p>
          {byModel.length === 0 ? (
            <p className="mt-2 text-xs text-ink/50">No {productName} runs in this range.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {priced.map((row, index) => (
                <li key={row.model} data-testid={`usage-model-row-${row.model}`}>
                  <div className="flex items-baseline justify-between gap-2 text-sm text-ink">
                    <span className="min-w-0 truncate font-medium" title={row.model}>
                      {row.model}
                    </span>
                    <span className="shrink-0 tabular-nums">{row.display}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(6, (row.usd / Math.max(...priced.map((r) => r.usd), 0.0001)) * 100)}%`,
                        backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink/50">
                    {row.runCount} run{row.runCount === 1 ? "" : "s"} · {tokenLabel(row.inputTokens)} in ·{" "}
                    {tokenLabel(row.outputTokens)} out
                  </p>
                </li>
              ))}
              {byModel
                .filter((row) => row.usd <= 0)
                .map((row) => (
                  <li key={row.model} className="text-[11px] text-ink/50" data-testid={`usage-model-row-${row.model}`}>
                    {row.model}: {row.unknown ? "billed after they finish" : row.display} · {row.runCount} run
                    {row.runCount === 1 ? "" : "s"}
                  </li>
                ))}
            </ul>
          )}
        </div>

        <p className="mt-6 text-xs text-ink/50">
          Desk estimate uses {productName} input and output tokens and {gatewayName} catalog prices. This-key wallet spend
          includes other apps on the same key and will not match the desk total.
        </p>
      </section>
    </main>
  );
}
