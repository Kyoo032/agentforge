/**
 * Budget versus actual.
 *
 * The parse answers with both sides kept apart (`budget[]`, `actual[]`, each a
 * label with its own figure per period), the pairing it proposes (`pairs[]`, two
 * labels and a confidence), and the labels it could not pair. A case's
 * `truth.lineItems` names rows on BOTH sides, so extraction reads both sides —
 * that is what "pairs → both sides" means.
 *
 * The confirm step's own act is accepting the proposed pairing, so `params.pairs`
 * is sent back exactly as it came. `budgetParamsSchema` treats an absent `pairs`
 * as "use the matcher's proposal", so sending it changes no number — it records
 * that the harness confirmed rather than silently relied on a default.
 */
import {
  financeExportBody,
  paramsOf,
  rowsFromLineItems,
  rowsFromPeriodSeries,
  scorable,
  shapeCounts,
  unscorable,
} from "./shared.mjs";

/**
 * The proposed pairing as the studio sends it back.
 *
 * `apps/web/lib/finance-budget.ts:budgetPairsForRequest` drops any proposal with an
 * empty side before it travels with the run — a line with no partner is not a
 * pair, and sending it as one would ask the task to compare a row with nothing.
 * The harness does the same, or it would be driving a screen nobody has.
 */
export function confirmedPairs(parsed) {
  return (Array.isArray(parsed?.pairs) ? parsed.pairs : [])
    .filter((pair) => pair?.budgetLabel && pair.actualLabel)
    .map((pair) => ({ budgetLabel: pair.budgetLabel, actualLabel: pair.actualLabel }));
}

/**
 * The pairs the app proposed, with each side's figure for one period attached, so
 * `scoreBudgetPairs` can check the numbers and not only the names. A side that has
 * no figure for the period keeps `NaN`, which is how "there is no budget line" is
 * said without inventing a zero.
 */
export function pairsWithAmounts(parsed, period) {
  const amountOf = (side, label) => {
    const line = (Array.isArray(side) ? side : []).find((entry) => entry?.label === label);
    const cells = Array.isArray(line?.amounts) ? line.amounts : [];
    const cell = period ? cells.find((one) => one.period === period) : cells[0];
    return Number.isFinite(cell?.amount) ? cell.amount : Number.NaN;
  };
  return (Array.isArray(parsed?.pairs) ? parsed.pairs : []).map((pair) => {
    const planned = pair.budgetLabel === null ? Number.NaN : amountOf(parsed?.budget, pair.budgetLabel);
    const actual = pair.actualLabel === null ? Number.NaN : amountOf(parsed?.actual, pair.actualLabel);
    return {
      label: pair.budgetLabel ?? pair.actualLabel ?? "",
      budgetLabel: pair.budgetLabel ?? null,
      actualLabel: pair.actualLabel ?? null,
      planned,
      actual,
      variance: Number.isFinite(planned) && Number.isFinite(actual) ? actual - planned : undefined,
      stage: pair.stage ?? "",
      score: pair.score,
    };
  });
}

export const budgetAdapter = {
  id: "budget",
  resultKind: "report",

  extractionRows(parsed) {
    const shapes = shapeCounts(parsed);
    const sides = [...rowsFromPeriodSeries(parsed?.budget), ...rowsFromPeriodSeries(parsed?.actual)];
    if (sides.length > 0) {
      return scorable(sides, "budget+actual sides", { shapes });
    }
    const fromItems = rowsFromLineItems(parsed?.items);
    if (fromItems.length > 0) {
      return scorable(fromItems, "items", {
        shapes,
        note: "the parse kept no `budget`/`actual` sides, so its flat `items` were scored",
      });
    }
    return unscorable(
      "the budget parse answered with neither side's rows nor labelled `items`, so it cannot express truth.lineItems",
      shapes,
    );
  },

  generateBody(kase, parsed) {
    const pairs = confirmedPairs(parsed);
    return {
      prompt: kase.prompt,
      task: "budget",
      items: parsed?.items ?? [],
      params: { ...paramsOf(kase), ...(pairs.length > 0 ? { pairs } : {}) },
      locale: kase.locale,
    };
  },

  exportBody(kase, run, format) {
    return financeExportBody({ report: run?.report, artifactId: run?.artifactId, format, task: kase.task });
  },
};
