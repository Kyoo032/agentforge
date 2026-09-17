"use client";

/**
 * The two sides, side by side, with the pairing the owner is about to confirm.
 *
 * Nothing on this screen is a variance yet. Every row says which budget line the reader is looking
 * at, which actual line it has been bound to, how sure the matcher is and what kind of argument
 * decided it — the same word, the finance dictionary, or the meaning of the two labels. A low chip is
 * an invitation to change the binding, and changing one frees whatever the two lines were bound to
 * before, because the assignment is one-to-one.
 *
 * A line the matcher would not call is not hidden behind a dropdown. It shows the two partners it
 * ranked highest as buttons, so the reader answers the question the matcher refused to answer alone,
 * in one click. The two buckets under the table are the lines that found nothing at all. They are not
 * an error: a budget line nobody spent and an actual line nobody budgeted are usually the most
 * interesting rows in the file, and forcing them into a pair would hide exactly that.
 */
import {
  budgetConfidence,
  budgetPairRows,
  budgetPartnerOptions,
  budgetStageGroup,
  budgetTopCandidates,
  budgetUnmatched,
  repairBudgetPair,
  type BudgetConfidence,
  type BudgetProposal,
  type BudgetProposalState,
} from "@/lib/finance-budget";
import { t } from "@/lib/i18n";

const CHIP: Record<BudgetConfidence, string> = {
  high: "bg-[var(--ok,var(--surface-2))] text-[var(--text)]",
  medium: "bg-[var(--surface-2,var(--surface))] text-[var(--text-2)]",
  low: "bg-[var(--warn,var(--surface))] text-[var(--text)]",
  none: "bg-[var(--surface)] text-[var(--text-3)]",
};

const CELL = "border-b border-[var(--line)] px-2 py-1 align-top text-[var(--text)]";

function Chip({ pair }: { pair: BudgetProposal }) {
  const level = budgetConfidence(pair);
  const group = budgetStageGroup(pair.stage);
  const label =
    level === "none"
      ? t(`finance.budget.pairing.stageGroup.${group === "meaning" ? "unmatched" : group}`)
      : t("finance.budget.pairing.chip", {
          stage: t(`finance.budget.pairing.stageGroup.${group}`),
          score: Math.round(pair.score * 100),
        });
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${CHIP[level]}`}
      data-testid="budget-pair-chip"
      data-stage={group}
    >
      {label}
    </span>
  );
}

/** The partners this line would most like, as buttons. One click binds; the table re-reads itself. */
function Candidates({
  state,
  pair,
  locked,
  onPairs,
}: {
  state: BudgetProposalState;
  pair: BudgetProposal;
  locked: boolean;
  onPairs: (next: BudgetProposal[]) => void;
}) {
  const offered = budgetTopCandidates(state, pair);
  if (offered.length === 0 || pair.budgetLabel === null) {
    return null;
  }
  const budgetLabel = pair.budgetLabel;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid={`budget-candidates-${budgetLabel}`}>
      <span className="text-[10px] text-[var(--text-3)]">{t("finance.budget.pairing.didYouMean")}</span>
      {offered.map((candidate) => (
        <button
          key={candidate.label}
          type="button"
          className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--text-2)] hover:text-[var(--text)]"
          onClick={() => onPairs(repairBudgetPair(state.pairs, budgetLabel, candidate.label))}
          disabled={locked}
          title={t("finance.budget.pairing.candidateTitle", {
            stage: t(`finance.budget.pairing.stageGroup.${budgetStageGroup(candidate.stage)}`),
            score: Math.round(candidate.score * 100),
          })}
        >
          {candidate.label}
        </button>
      ))}
    </div>
  );
}

function Bucket({ title, labels, testId }: { title: string; labels: readonly string[]; testId: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-[var(--text-2)]">
        {title} · {labels.length}
      </p>
      {labels.length === 0 ? (
        <p className="mt-1 text-[11px] text-[var(--text-3)]">{t("finance.budget.pairing.bucketEmpty")}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--text-2)]" data-testid={testId}>
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartnerCell({
  state,
  pair,
  locked,
  onPairs,
}: {
  state: BudgetProposalState;
  pair: BudgetProposal;
  locked: boolean;
  onPairs: (next: BudgetProposal[]) => void;
}) {
  if (pair.budgetLabel === null) {
    return <>{pair.actualLabel}</>;
  }
  const budgetLabel = pair.budgetLabel;
  return (
    <>
      <select
        className="input px-2 py-1 text-xs"
        value={pair.actualLabel ?? ""}
        aria-label={t("finance.budget.pairing.selectAria", { line: budgetLabel })}
        onChange={(event) => onPairs(repairBudgetPair(state.pairs, budgetLabel, event.target.value || null))}
        disabled={locked}
        data-testid={`budget-pair-${budgetLabel}`}
      >
        <option value="">{t("finance.budget.pairing.none")}</option>
        {budgetPartnerOptions(state, budgetLabel).map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
      <Candidates state={state} pair={pair} locked={locked} onPairs={onPairs} />
    </>
  );
}

export function BudgetPairingTable({
  state,
  locked,
  onPairs,
}: {
  state: BudgetProposalState;
  locked: boolean;
  onPairs: (next: BudgetProposal[]) => void;
}) {
  const rows = budgetPairRows(state);
  const buckets = budgetUnmatched(state);
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--text-3)]">{t("finance.budget.pairing.empty")}</p>;
  }
  return (
    <div className="space-y-3">
      <table className="w-full text-left text-xs" data-testid="budget-pairing">
        <thead>
          <tr className="text-[var(--text-3)]">
            <th className={CELL}>{t("finance.budget.pairing.budgetSide")}</th>
            <th className={CELL}>{t("finance.budget.pairing.actualSide")}</th>
            <th className={CELL}>{t("finance.budget.pairing.confidence")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pair) => (
            <tr key={`${pair.budgetLabel ?? ""}|${pair.actualLabel ?? ""}`}>
              <td className={CELL}>{pair.budgetLabel ?? <span className="text-[var(--text-3)]">—</span>}</td>
              <td className={CELL}>
                <PartnerCell state={state} pair={pair} locked={locked} onPairs={onPairs} />
              </td>
              <td className={CELL}>
                <Chip pair={pair} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The reader is told when a whole stage did not run, rather than left to wonder why a line is loose. */}
      {state.embedding === "unavailable" ? (
        <p className="text-[11px] text-[var(--text-3)]" data-testid="budget-embedding-note">
          {t("finance.budget.pairing.meaningUnavailable")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Bucket
          title={t("finance.budget.pairing.budgetOnly")}
          labels={buckets.budget}
          testId="budget-bucket-budget"
        />
        <Bucket
          title={t("finance.budget.pairing.actualOnly")}
          labels={buckets.actual}
          testId="budget-bucket-actual"
        />
      </div>
      {state.excluded.length > 0 ? (
        <p className="text-[11px] text-[var(--text-3)]" data-testid="budget-excluded">
          {t("finance.budget.pairing.excluded", {
            count: state.excluded.length,
            labels: state.excluded.map((row) => row.label).join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}
