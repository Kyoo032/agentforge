"use client";

import { formatUsd } from "@agentforge/core/gateway";
import { Link } from "@/lib/nav";

export type ThisKeyStatus =
  | { status: "needs_key" }
  | { status: "ok"; data: { usedUsd: number; remainingUsd: number | null; unlimited: boolean; name?: string } }
  | { status: "error"; message: string };

export type DeskModelRow = {
  model: string;
  usd: number;
  display: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  unknown: boolean;
};

/** Settings / chat chip payload (subset; may omit range fields). */
export type AccountUsage = {
  thisKey?: ThisKeyStatus;
  desk?: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    modelCount?: number;
    byModel?: DeskModelRow[];
    error?: string;
  };
};

export type UsageRange = "day" | "week" | "month";

export type RangeUsage = {
  range: UsageRange;
  thisKey: ThisKeyStatus;
  desk: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    modelCount: number;
    byModel: DeskModelRow[];
  };
  buckets: Array<{
    key: string;
    label: string;
    usd: number;
    models: Array<{
      model: string;
      usd: number;
      runCount: number;
      inputTokens: number;
      outputTokens: number;
    }>;
  }>;
};

export const BAR_COLORS = ["#0f766e", "#5d5d5d", "#9e9e9e", "#292929", "#c5c5c1"];

export function thisKeyLine(usage: { thisKey?: ThisKeyStatus } | null): string {
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

export function tokenLabel(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

export function KeyQuotaMeter({ usage }: { usage: { thisKey?: ThisKeyStatus } | null }) {
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
        <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
      </div>
    </div>
  );
}

/** Compact Settings strip: this-key + Open Usage. */
export function UsagePanel({ usage }: { usage: AccountUsage | null }) {
  return (
    <div className="blueprint p-[18px]" data-testid="usage-panel">
      <p className="panel-label">Usage</p>
      <p className="mt-2 text-sm text-inkbase" data-testid="usage-this-key">
        This key: {thisKeyLine(usage)}
      </p>
      <KeyQuotaMeter usage={usage} />
      <p className="mt-3">
        <Link href="/usage" className="text-[14px] text-[var(--accent)] underline underline-offset-2" data-testid="usage-open">
          Open Usage
        </Link>
      </p>
    </div>
  );
}
