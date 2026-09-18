"use client";

/**
 * The figures a document stated in a sentence, held up for confirmation before the brief uses them.
 *
 * An annual report puts its revenue in a table and its headcount, its store count, its current ratio
 * and its dividend in prose. Those are figures a reader counts, and a brief written from the tables
 * alone is missing exactly the ones the owner asked about — so they are listed here, each with the
 * sentence it came from, a name the owner may correct, and a way to throw it out.
 *
 * Two things this list will not do. It never changes a figure: the amount was read in code from the
 * document's own words and there is no box to type a different one into. And nothing here is ever
 * added up — a stated fact is a quotation the brief may repeat, not an input to any sum.
 */
import type { StatedFact } from "@/lib/finance-client";
import { t } from "@/lib/i18n";

export type StatedFactsListProps = {
  readonly facts: readonly StatedFact[];
  readonly onChange: (next: StatedFact[]) => void;
  readonly disabled?: boolean;
};

/** The figure exactly as the document wrote it, with the unit it carried. Never re-rounded. */
function figureText(fact: StatedFact): string {
  const amount = fact.value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (fact.unit === "percent") {
    return `${amount}%`;
  }
  if (fact.unit === "ratio") {
    return `${amount}x`;
  }
  return fact.currency ? `${fact.currency} ${amount}` : amount;
}

function factKey(fact: StatedFact, at: number): string {
  return fact.id || `${at}-${fact.value}`;
}

export function StatedFactsList({ facts, onChange, disabled = false }: StatedFactsListProps) {
  if (facts.length === 0) {
    return null;
  }
  const rename = (at: number, label: string) =>
    onChange(facts.map((fact, index) => (index === at ? { ...fact, label } : fact)));
  return (
    <div data-testid="finance-stated-facts">
      <p className="panel-label">{t("finance.brief.statedFacts.title", { count: facts.length })}</p>
      <p className="mt-0.5 text-xs text-[var(--text-3)]">{t("finance.brief.statedFacts.hint")}</p>
      <ul className="mt-2 space-y-2">
        {facts.map((fact, at) => (
          <li
            key={factKey(fact, at)}
            className="rounded-lg border border-[var(--line)] px-2 py-1.5"
            data-testid="finance-stated-fact"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="input flex-1 px-2 py-1 text-xs"
                value={fact.label}
                onChange={(event) => rename(at, event.target.value)}
                disabled={disabled}
                placeholder={t("finance.brief.statedFacts.labelPlaceholder")}
                aria-label={t("finance.brief.statedFacts.labelAria")}
                data-testid="finance-stated-fact-label"
              />
              <span className="shrink-0 text-xs tabular-nums text-[var(--text)]" data-testid="finance-stated-fact-value">
                {figureText(fact)}
              </span>
              <button
                type="button"
                className="btn px-2 py-1 text-xs"
                onClick={() => onChange(facts.filter((_unused, index) => index !== at))}
                disabled={disabled}
                aria-label={t("finance.brief.statedFacts.removeAria")}
                data-testid="finance-stated-fact-remove"
              >
                {t("finance.brief.statedFacts.remove")}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[var(--text-3)]" data-testid="finance-stated-fact-sentence">
              {fact.sentence}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
