/**
 * The ratio health check.
 *
 * The parse answers with `buckets[]` — every statement row with the bucket it was
 * placed in, its confidence and the evidence — plus the same rows as `items`. The
 * buckets carry the sheet's own label, period and amount, so that is what the
 * extraction score reads.
 *
 * The confirm step's act is accepting the placement. `params.buckets` stays empty
 * on purpose: an empty override list means "classify as you proposed", which is
 * precisely what accepting without editing is. Sending the proposals back as
 * `source: "override"` rows would tell the app they were hand-set, and a later
 * change to the classifier would then be hidden from this eval.
 *
 * `params.stated` carries the parse's `stated` rows straight through, because the
 * web step does exactly that when the owner hits Read: the sheet's own subtotals
 * are what the job checks its figures against, so an eval that dropped them would
 * be driving a different app from the one a person uses.
 */
import { financeExportBody, paramsOf, rowsFromLineItems, scorable, shapeCounts, unscorable } from "./shared.mjs";

/** `{ label, period, amount }` from a classified row, which already carries all three. */
export function rowsFromBuckets(buckets) {
  return (Array.isArray(buckets) ? buckets : []).flatMap((row) =>
    typeof row?.label === "string" && row.label.trim() !== "" && Number.isFinite(row?.amount)
      ? [{ label: row.label, period: typeof row.period === "string" ? row.period : "", amount: row.amount }]
      : [],
  );
}

/** The parse's `stated` rows, as the step component forwards them: label, period, amount. */
export function statedFrom(parsed) {
  const rows = Array.isArray(parsed?.stated) ? parsed.stated : [];
  return rows.flatMap((row) =>
    typeof row?.label === "string" && row.label.trim() !== "" && Number.isFinite(row?.amount)
      ? [{ label: row.label, period: typeof row.period === "string" ? row.period : "", amount: row.amount }]
      : [],
  );
}

export const ratiosAdapter = {
  id: "ratios",
  resultKind: "report",

  extractionRows(parsed) {
    const shapes = shapeCounts(parsed);
    const fromBuckets = rowsFromBuckets(parsed?.buckets);
    if (fromBuckets.length > 0) {
      return scorable(fromBuckets, "buckets", { shapes });
    }
    const fromItems = rowsFromLineItems(parsed?.items);
    if (fromItems.length > 0) {
      return scorable(fromItems, "items", {
        shapes,
        note: "the parse answered with no `buckets`, so `items` were scored",
      });
    }
    return unscorable(
      "the ratios parse answered with neither `buckets` nor labelled `items`, so it cannot express truth.lineItems",
      shapes,
    );
  },

  generateBody(kase, parsed) {
    const params = paramsOf(kase);
    return {
      prompt: kase.prompt,
      task: "ratios",
      items: parsed?.items ?? [],
      // `buckets: []` is "confirmed as proposed". `bands` likewise: the documented
      // rule-of-thumb thresholds are what the reader saw and did not move.
      params: { buckets: [], bands: [], stated: statedFrom(parsed), ...params },
      locale: kase.locale,
    };
  },

  exportBody(kase, run, format) {
    return financeExportBody({ report: run?.report, artifactId: run?.artifactId, format, task: kase.task });
  },
};
