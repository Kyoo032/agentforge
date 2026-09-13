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

function chartMinKeep(range: UsageRange): number {
  if (range === "week") {
    return 4;
  }
  if (range === "month") {
    return 4;
  }
  return 7;
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

  const ready = usage != null;
  const desk = usage?.desk ?? emptyDesk();
  const byModel = desk.byModel ?? [];
  const priced = byModel.filter((row) => row.usd > 0);
  const maxPriced = Math.max(...priced.map((row) => row.usd), 0.0001);

  return (
    <main className="px-6 py-8 text-[var(--text)]" data-testid="usage-page">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="kicker">Account</div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">Usage</h3>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">
            This-key wallet and desk spend for the selected range.
          </p>
        </div>
        <div className="seg ml-auto" data-testid="usage-range" role="group" aria-label="Usage range">
          {RANGES.map((option) => {
            const active = range === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className="seg-opt"
                data-on={active ? "true" : "false"}
                aria-pressed={active}
                data-testid={`usage-range-${option.id}`}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {loadError ? <p className="mb-4 text-sm text-red-700">{loadError}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="panel-label">This key</p>
          <p className="mt-2 text-2xl font-medium tabular-nums tracking-[var(--track)] text-[var(--text)]" data-testid="usage-this-key">
            {loading && !ready ? "Loading…" : thisKeyLine(usage)}
          </p>
          <KeyQuotaMeter usage={usage} />
        </section>
        <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="panel-label">This desk</p>
          <p className="mt-2 text-sm font-medium tabular-nums text-[var(--text)]" data-testid="usage-desk-range">
            {loading && !ready
              ? "Loading…"
              : `${desk.display} · ${desk.modelCount} model${desk.modelCount === 1 ? "" : "s"}`}
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            {ready ? `${desk.pricedCount} priced run${desk.pricedCount === 1 ? "" : "s"} in this range.` : "Fetching desk spend…"}
          </p>
        </section>
      </div>

      <section className="raise mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="panel-label">Spend over time</p>
        {loading && !ready ? (
          <p className="mt-4 text-sm text-[var(--text-2)]">Loading…</p>
        ) : (
          <UsageRangeChart
            buckets={usage?.buckets ?? []}
            productName={productName}
            minKeep={chartMinKeep(range)}
          />
        )}
      </section>

      <section className="raise mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-testid="usage-by-model">
        <p className="panel-label">Spend by model</p>
        {!ready && loading ? (
          <p className="mt-3 text-sm text-[var(--text-2)]">Loading…</p>
        ) : byModel.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-2)]">
            No {productName} runs in this range.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {priced.map((row, index) => (
              <li key={row.model} data-testid={`usage-model-row-${row.model}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm text-[var(--text)]">
                  <span className="min-w-0 truncate font-medium" title={row.model}>
                    {row.model}
                  </span>
                  <span className="shrink-0 tabular-nums">{row.display}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, (row.usd / maxPriced) * 100)}%`,
                      backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--text-2)]">
                  {row.runCount} run{row.runCount === 1 ? "" : "s"} · {tokenLabel(row.inputTokens)} in ·{" "}
                  {tokenLabel(row.outputTokens)} out
                </p>
              </li>
            ))}
            {byModel
              .filter((row) => row.usd <= 0)
              .map((row) => (
                <li
                  key={row.model}
                  className="text-xs text-[var(--text-2)]"
                  data-testid={`usage-model-row-${row.model}`}
                >
                  {row.model}: {row.unknown ? "billed after they finish" : row.display} · {row.runCount} run
                  {row.runCount === 1 ? "" : "s"}
                </li>
              ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-xs text-[var(--text-3)]">
        Desk estimate uses {productName} input and output tokens and {gatewayName} catalog prices. This-key wallet spend
        includes other apps on the same key and will not match the desk total.
      </p>
    </main>
  );
}
