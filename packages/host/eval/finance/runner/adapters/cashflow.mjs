/**
 * Cash flow and runway.
 *
 * The parse answers with `{ items, categories, periods, openingCash, currency,
 * warnings }`. Two shapes could stand in for the owner's rows and they are not the
 * same thing:
 *
 * - `items` is the folded view — one cash-in and one cash-out row per period (plus
 *   financing on its own line) under the names the source book was written in
 *   ("Total kas masuk" / "Operating cash in"). This is what the confirm step is:
 *   `CashflowPeriodsTable` renders exactly these rows, one per period, and the
 *   reader retypes any figure that is wrong straight into them.
 * - `categories` keeps every SOURCE label — "Penjualan tunai", "Cloud hosting" —
 *   with its own figure per period. On screen it is only the classification list,
 *   which shows a label, a side and a cost-behaviour dropdown and **no amounts and
 *   no periods**. The reader never confirms a figure there.
 *
 * So the adapter scores `items`: those are the (label, period, amount) triples the
 * owner actually confirms, and the ones `truth.lineItems` is written from. It falls
 * back to `categories` only when a parse folded nothing, and says which it used.
 * Generate is sent `items` unchanged, because those are the rows the confirm step
 * holds and the ones `cashflowInputSchema` accepts.
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

export const cashflowAdapter = {
  id: "cashflow",
  resultKind: "report",

  extractionRows(parsed) {
    const shapes = shapeCounts(parsed);
    const fromItems = rowsFromLineItems(parsed?.items);
    if (fromItems.length > 0) {
      return scorable(fromItems, "items", { shapes });
    }
    const fromCategories = rowsFromPeriodSeries(parsed?.categories);
    if (fromCategories.length > 0) {
      return scorable(fromCategories, "categories", {
        shapes,
        note: "the parse folded no period rows, so the source category grid was scored; the confirm table shows the folded rows, not these",
      });
    }
    return unscorable(
      "the cash-flow parse answered with neither labelled `items` nor `categories`, so it cannot express truth.lineItems",
      shapes,
    );
  },

  generateBody(kase, parsed) {
    const params = paramsOf(kase);
    return {
      prompt: kase.prompt,
      task: "cashflow",
      items: parsed?.items ?? [],
      // The opening balance the parse read is what the panel prefills; a case that
      // names one of its own is the owner typing over it, so the case wins.
      params: {
        ...(Number.isFinite(parsed?.openingCash) ? { openingCash: parsed.openingCash } : {}),
        ...params,
      },
      locale: kase.locale,
    };
  },

  exportBody(kase, run, format) {
    return financeExportBody({ report: run?.report, artifactId: run?.artifactId, format, task: kase.task });
  },
};
