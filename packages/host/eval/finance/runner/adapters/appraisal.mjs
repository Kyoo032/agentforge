/**
 * Investment appraisal.
 *
 * The parse answers with the component rows (`items` — outlay, savings, salvage,
 * each with its own label and year) and the same rows netted per year (`flows` —
 * `{ period, year, amount, components }`). A case's `truth.lineItems` names the
 * COMPONENTS, so `items` is what extraction reads.
 *
 * `flows` is the confirm step's own table and it deliberately carries no label:
 * it is one net number per year. When a parse answers with flows and nothing else
 * the adapter says so rather than scoring zero, because "0.000" would read as "the
 * app got every row wrong" when the truth is "this shape cannot hold a row name".
 */
import { financeExportBody, paramsOf, rowsFromLineItems, scorable, shapeCounts, unscorable } from "./shared.mjs";

/** Each year's net flow keyed by period. Not a label — used only to describe the shape. */
export function flowRows(flows) {
  return (Array.isArray(flows) ? flows : []).flatMap((flow) =>
    Number.isFinite(flow?.amount)
      ? [{ period: typeof flow.period === "string" ? flow.period : String(flow.year ?? ""), amount: flow.amount }]
      : [],
  );
}

export const appraisalAdapter = {
  id: "appraisal",
  resultKind: "report",

  extractionRows(parsed) {
    const shapes = shapeCounts(parsed);
    const fromItems = rowsFromLineItems(parsed?.items);
    if (fromItems.length > 0) {
      return scorable(fromItems, "items", { shapes });
    }
    const flows = flowRows(parsed?.flows);
    if (flows.length > 0) {
      return unscorable(
        `the appraisal parse answered with ${flows.length} netted year flow(s) and no component rows; a flow is one number per year with no label, so it cannot express truth.lineItems (label, period, amount)`,
        shapes,
      );
    }
    return unscorable("the appraisal parse answered with neither `items` nor `flows`", shapes);
  },

  generateBody(kase, parsed) {
    const params = paramsOf(kase);
    const prefilled =
      Number.isFinite(parsed?.discountRatePercent) &&
      params.discountRatePercent === undefined &&
      params.discountRate === undefined
        ? { discountRatePercent: parsed.discountRatePercent }
        : {};
    return {
      prompt: kase.prompt,
      task: "appraisal",
      items: parsed?.items ?? [],
      params: { ...prefilled, ...params },
      locale: kase.locale,
    };
  },

  exportBody(kase, run, format) {
    return financeExportBody({ report: run?.report, artifactId: run?.artifactId, format, task: kase.task });
  },
};
