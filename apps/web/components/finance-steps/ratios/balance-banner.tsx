"use client";

/**
 * The one thing an owner must see before reading any ratio: whether the balance sheet balances.
 *
 * It is a banner rather than a footnote because a statement whose two sides disagree makes every
 * leverage ratio below it wrong, and the fix — a row in the wrong bucket — is one dropdown away in
 * the table underneath. When it does not balance, the banner says *which* totals disagree and by how
 * much, rather than only that something is off.
 */
import { formatRatioValue } from "@agentforge/core/finance";
import type { RatiosBalanceRow } from "@/lib/finance-ratios-draft";
import { getLocale, t } from "@/lib/i18n";

const TONE: Record<RatiosBalanceRow["state"], string> = {
  balanced: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)]",
  broken: "border-[var(--danger)] bg-[var(--danger-wash,var(--surface-2))] text-[var(--danger)]",
  unknown: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)]",
};

function line(row: RatiosBalanceRow, currency: string): string {
  const locale = getLocale() === "id" ? "id" : "en";
  if (row.state === "unknown") {
    return t("finance.ratios.balance.unknown", { period: row.period || "—" });
  }
  if (row.state === "balanced") {
    return t("finance.ratios.balance.ok", {
      period: row.period || "—",
      assets: formatRatioValue(row.assets, "currency", locale, currency),
    });
  }
  return t("finance.ratios.balance.broken", {
    period: row.period || "—",
    difference: formatRatioValue(row.difference, "currency", locale, currency),
    assets: formatRatioValue(row.assets, "currency", locale, currency),
    liabilities: formatRatioValue(row.liabilities, "currency", locale, currency),
    equity: formatRatioValue(row.equity, "currency", locale, currency),
  });
}

export function RatiosBalanceBanner({ rows, currency }: { rows: readonly RatiosBalanceRow[]; currency: string }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1" data-testid="finance-ratios-balance">
      <p className="panel-label">{t("finance.ratios.balance.heading")}</p>
      {rows.map((row) => (
        <p
          key={row.period}
          className={`rounded-lg border px-3 py-2 text-xs ${TONE[row.state]}`}
          role={row.state === "broken" ? "alert" : "status"}
          data-testid={`finance-ratios-balance-${row.state}`}
        >
          {line(row, currency)}
        </p>
      ))}
    </div>
  );
}
