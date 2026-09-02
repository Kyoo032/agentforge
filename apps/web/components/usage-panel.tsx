"use client";

import { formatUsd } from "@agentforge/core/gateway";

export type AccountUsage = {
  thisKey?:
    | { status: "needs_key" }
    | { status: "ok"; data: { usedUsd: number; remainingUsd: number | null; unlimited: boolean; name?: string } }
    | { status: "error"; message: string };
  desk?: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    byModel?: Array<{
      model: string;
      usd: number;
      display: string;
      runCount: number;
      inputTokens: number;
      outputTokens: number;
      unknown: boolean;
    }>;
    error?: string;
  };
};

const BAR_COLORS = ["#1565c0", "#0d47a1", "#00838f", "#5e35b1", "#0277bd"];

function thisKeyLine(usage: AccountUsage | null): string {
  const thisKey = usage?.thisKey;
  if (!thisKey || thisKey.status === "needs_key") {
    return "Paste a gateway key to see spend.";
  }
  if (thisKey.status === "error") {
    return thisKey.message;
  }
  const used = formatUsd(thisKey.data.usedUsd);
  if (thisKey.data.unlimited) {
    return `${used} used · Unlimited`;
  }
  const left = thisKey.data.remainingUsd == null ? "—" : formatUsd(thisKey.data.remainingUsd);
  return `${used} used · ${left} left`;
}

function deskLine(usage: AccountUsage | null): string {
  if (!usage?.desk) {
    return formatUsd(0);
  }
  if (usage.desk.error) {
    return usage.desk.error;
  }
  if (usage.desk.unknownCount > 0) {
    return `${usage.desk.display} · ${usage.desk.unknownCount} job${usage.desk.unknownCount === 1 ? "" : "s"} billed after they finish`;
  }
  return usage.desk.display;
}

function tokenLabel(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

function KeyQuotaMeter({ usage }: { usage: AccountUsage | null }) {
  const thisKey = usage?.thisKey;
  if (!thisKey || thisKey.status !== "ok") {
    return null;
  }
  const used = Math.max(0, thisKey.data.usedUsd);
  const remaining = thisKey.data.unlimited ? null : thisKey.data.remainingUsd;
  const total = remaining == null ? Math.max(used, 1) : used + Math.max(0, remaining);
  const usedPct = thisKey.data.unlimited ? 8 : total <= 0 ? 0 : Math.min(100, (used / total) * 100);
  return (
    <div className="mt-2" data-testid="usage-key-meter">
      <div
        className="h-2.5 overflow-hidden rounded-full bg-mist"
        role="img"
        aria-label={
          thisKey.data.unlimited
            ? `This key used ${formatUsd(used)}, unlimited remaining`
            : `This key used ${formatUsd(used)} of ${formatUsd(total)}`
        }
      >
        <div className="h-full rounded-full bg-navy" style={{ width: `${usedPct}%` }} />
      </div>
    </div>
  );
}

function ModelSpendChart({ usage }: { usage: AccountUsage | null }) {
  const rows = usage?.desk?.byModel ?? [];
  const priced = rows.filter((row) => row.usd > 0);
  const maxUsd = priced.reduce((max, row) => Math.max(max, row.usd), 0);

  if (rows.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink/50" data-testid="usage-by-model">
        No Agentforge runs yet. Chat or generate on this desk to see spend by model.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3" data-testid="usage-by-model">
      <p className="text-xs font-medium text-ink/70">Spend by model (this desk)</p>
      {priced.length > 0 ? (
        <div className="space-y-2.5" data-testid="usage-model-chart">
          {priced.map((row, index) => {
            const width = maxUsd > 0 ? Math.max(6, (row.usd / maxUsd) * 100) : 0;
            return (
              <div key={row.model} data-testid={`usage-model-row-${row.model}`}>
                <div className="flex items-baseline justify-between gap-2 text-xs text-ink">
                  <span className="min-w-0 truncate font-medium" title={row.model}>
                    {row.model}
                  </span>
                  <span className="shrink-0 tabular-nums">{row.display}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-mist">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${width}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink/50">
                  {row.runCount} run{row.runCount === 1 ? "" : "s"} · {tokenLabel(row.inputTokens)} in ·{" "}
                  {tokenLabel(row.outputTokens)} out
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
      {rows
        .filter((row) => row.usd <= 0)
        .map((row) => (
          <p key={row.model} className="text-[11px] text-ink/50" data-testid={`usage-model-row-${row.model}`}>
            {row.model}: {row.unknown ? "billed after they finish" : row.display} · {row.runCount} run
            {row.runCount === 1 ? "" : "s"}
          </p>
        ))}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: AccountUsage | null }) {
  return (
    <div className="rounded-lg border border-mist px-4 py-3" data-testid="usage-panel">
      <h3 className="text-sm font-medium text-ink">Usage</h3>
      <p className="mt-2 text-sm text-ink" data-testid="usage-this-key">
        This key: {thisKeyLine(usage)}
      </p>
      <KeyQuotaMeter usage={usage} />
      <p className="mt-2 text-sm text-ink" data-testid="usage-desk-estimate">
        This desk (estimate): {deskLine(usage)}
      </p>
      <ModelSpendChart usage={usage} />
      <p className="mt-2 text-xs text-ink/50">
        Desk estimate uses Agentforge input and output tokens and Toko Token catalog prices. Other apps on the same key
        are not included. Image and video jobs billed after they finish are omitted.
      </p>
    </div>
  );
}
