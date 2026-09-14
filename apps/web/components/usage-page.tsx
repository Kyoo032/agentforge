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
import { t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";

function rangeLabel(id: UsageRange): string {
  return t(`usage.range.${id}`);
}

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
          setLoadError(res.status === 404 ? t("usage.errors.unavailable") : t("usage.errors.loadStatus", { status: res.status }));
          return;
        }
        const payload: unknown = await res.json();
        const parsed = parseUsage(payload, nextRange);
        if (!parsed) {
          setUsage(null);
          setLoadError(t("usage.errors.incomplete"));
          return;
        }
        setUsage(parsed);
      })
      .catch(() => {
        setUsage(null);
        setLoadError(t("usage.errors.load"));
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
          <div className="kicker">{t("usage.kicker")}</div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("usage.title")}</h3>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">{t("usage.intro")}</p>
        </div>
        <div className="seg ml-auto" data-testid="usage-range" role="group" aria-label={t("usage.rangeAria")}>
          {(["day", "week", "month"] as const).map((id) => {
            const active = range === id;
            return (
              <button
                key={id}
                type="button"
                className="seg-opt"
                data-on={active ? "true" : "false"}
                aria-pressed={active}
                data-testid={`usage-range-${id}`}
                onClick={() => setRange(id)}
              >
                {rangeLabel(id)}
              </button>
            );
          })}
        </div>
      </div>

      {loadError ? <p className="mb-4 text-sm text-red-700">{loadError}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="panel-label">{t("usage.thisKey.label")}</p>
          <p className="mt-2 text-2xl font-medium tabular-nums tracking-[var(--track)] text-[var(--text)]" data-testid="usage-this-key">
            {loading && !ready ? t("usage.loading") : thisKeyLine(usage)}
          </p>
          <KeyQuotaMeter usage={usage} />
        </section>
        <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="panel-label">{t("usage.desk.label")}</p>
          <p className="mt-2 text-sm font-medium tabular-nums text-[var(--text)]" data-testid="usage-desk-range">
            {loading && !ready
              ? t("usage.loading")
              : t(desk.modelCount === 1 ? "usage.desk.summaryOne" : "usage.desk.summary", {
                  display: desk.display,
                  count: desk.modelCount,
                })}
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            {ready
              ? t(desk.pricedCount === 1 ? "usage.desk.pricedOne" : "usage.desk.priced", { count: desk.pricedCount })
              : t("usage.desk.fetching")}
          </p>
        </section>
      </div>

      <section className="raise mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="panel-label">{t("usage.chart.label")}</p>
        {loading && !ready ? (
          <p className="mt-4 text-sm text-[var(--text-2)]">{t("usage.loading")}</p>
        ) : (
          <UsageRangeChart
            buckets={usage?.buckets ?? []}
            productName={productName}
            minKeep={chartMinKeep(range)}
          />
        )}
      </section>

      <section className="raise mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-testid="usage-by-model">
        <p className="panel-label">{t("usage.byModel.label")}</p>
        {!ready && loading ? (
          <p className="mt-3 text-sm text-[var(--text-2)]">{t("usage.loading")}</p>
        ) : byModel.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-2)]">
            {t("usage.byModel.empty", { productName })}
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
                  {t(row.runCount === 1 ? "usage.byModel.rowOne" : "usage.byModel.row", {
                    runs: row.runCount,
                    input: tokenLabel(row.inputTokens),
                    output: tokenLabel(row.outputTokens),
                  })}
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
                  {row.unknown
                    ? t(row.runCount === 1 ? "usage.byModel.unpricedOne" : "usage.byModel.unpriced", {
                        model: row.model,
                        runs: row.runCount,
                      })
                    : t(row.runCount === 1 ? "usage.byModel.unpricedKnownOne" : "usage.byModel.unpricedKnown", {
                        model: row.model,
                        display: row.display,
                        runs: row.runCount,
                      })}
                </li>
              ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-xs text-[var(--text-3)]">
        {t("usage.footer", { productName, gatewayName })}
      </p>
    </main>
  );
}
