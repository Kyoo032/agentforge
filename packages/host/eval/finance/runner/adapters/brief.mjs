/**
 * The financial brief — the task Finance has always done.
 *
 * `POST /finance/parse` answers with `{ items, derived, proseFacts }` and the confirm
 * step takes all three as they come: the items are the rows the owner confirms, the
 * `derived` list is the totals the source printed — shown beside the items and never
 * summed — and `proseFacts` are the figures a document only ever wrote in a sentence,
 * kept or thrown out one by one. This adapter confirms every one of them as proposed,
 * which is the eval's contract, and posts the kept facts back as `statedFacts` the way
 * `apps/web/components/finance-steps/brief/index.tsx:briefInputsBody` does.
 *
 * Generate and export both speak `FinanceBrief`, not `FinanceReport`.
 */
import { labelsMatch, pairUp, periodsMatch } from "../labels.mjs";
import { amountsMatch } from "../numbers.mjs";
import { financeExportBody, paramsOf, rowsFromLineItems, scorable, shapeCounts, unscorable } from "./shared.mjs";

/** The units `apps/web/lib/finance-client.ts` will accept from the host; anything else is a number. */
const FACT_UNITS = ["currency", "percent", "ratio", "months", "count", "number"];

/** The category a case files a total it expects the product to recognise as one under. */
const SUBTOTAL_CATEGORY = "subtotal";

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * `factsFrom` + `usableStatedFacts` from the web client, to the letter: a fact needs a
 * finite figure and a name of some kind, an unknown unit reads as a plain number, and
 * nothing else is repaired.
 */
export function statedFactsFrom(proseFacts) {
  return (Array.isArray(proseFacts) ? proseFacts : []).flatMap((entry) => {
    const fact = entry ?? {};
    if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) {
      return [];
    }
    const label = text(fact.label);
    const sentence = text(fact.sentence);
    if (label.trim() === "" && sentence.trim() === "") {
      return [];
    }
    return [
      {
        id: text(fact.id),
        label,
        sentence,
        value: fact.value,
        unit: FACT_UNITS.find((name) => name === fact.unit) ?? "number",
        currency: text(fact.currency),
      },
    ];
  });
}

/** One truth row and one proposed row are the same row: same name, same period, same figure. */
function sameRow(truth, candidate) {
  return (
    labelsMatch(truth.label, candidate.label) &&
    periodsMatch(truth.period ?? "", candidate.period ?? "") &&
    amountsMatch(truth.amount, candidate.amount, undefined)
  );
}

/**
 * The derived rows that answer a total the case itself files as a `subtotal`.
 *
 * Two rules, and they pull in opposite directions on purpose. A truth row the case
 * calls a subtotal — "Laba kotor", "Laba usaha" — is a row the product is right to
 * show as derived, so it may be answered from that list. Every other truth row must
 * come from `items`, and every derived row the truth does not name is dropped rather
 * than scored: the confirm step shows it and never sums it, so counting it as an extra
 * would mark the product down for doing the right thing.
 *
 * This can only ever REMOVE rows the parse proposed. It cannot invent one, so a
 * subtotal the app read wrongly stays a miss.
 */
function derivedAnsweringSubtotals(truth, derivedRows) {
  const subtotals = (Array.isArray(truth?.lineItems) ? truth.lineItems : []).filter(
    (row) => row?.category === SUBTOTAL_CATEGORY,
  );
  if (subtotals.length === 0 || derivedRows.length === 0) {
    return [];
  }
  return pairUp(subtotals, derivedRows, sameRow).pairs.map((pair) => pair.candidate);
}

function derivedNote(matched, derivedTotal) {
  return (
    `${matched} truth subtotal row(s) were answered from the parse's \`derived\` list; ` +
    `the other ${derivedTotal - matched} derived row(s) were left out of the score, because the ` +
    `confirm step shows them and never sums one`
  );
}

export const briefAdapter = {
  id: "brief",
  /** The brief answers with a `FinanceBrief`; every other task answers with a `FinanceReport`. */
  resultKind: "brief",

  /**
   * The body the Read button posts, as `apps/web/lib/finance-client.ts:parseFinanceFigures`
   * builds it: the figures, the task, and a document's prose so the figures it only ever
   * wrote in a sentence are not lost. The brief's parse reads no prompt and no parameters,
   * and the studio sends neither.
   */
  parseBody(kase) {
    const prose = text(kase?.proseText);
    return {
      figures: kase?.figuresText,
      task: "brief",
      ...(prose.trim() === "" ? {} : { proseText: prose }),
    };
  },

  extractionRows(parsed, kase) {
    const rows = rowsFromLineItems(parsed?.items);
    if (rows.length === 0 && (parsed?.items ?? []).length > 0) {
      return unscorable("the parse answered with rows that carry no label or no finite amount", shapeCounts(parsed));
    }
    const derivedRows = rowsFromLineItems(parsed?.derived);
    const answering = derivedAnsweringSubtotals(kase?.truth, derivedRows);
    if (derivedRows.length === 0) {
      return scorable(rows, "items", { shapes: shapeCounts(parsed) });
    }
    return scorable([...rows, ...answering], answering.length > 0 ? "items+derived" : "items", {
      shapes: shapeCounts(parsed),
      note: derivedNote(answering.length, derivedRows.length),
    });
  },

  generateBody(kase, parsed) {
    const facts = statedFactsFrom(parsed?.proseFacts);
    return {
      prompt: kase.prompt,
      task: "brief",
      items: parsed?.items ?? [],
      params: paramsOf(kase),
      locale: kase.locale,
      ...(facts.length > 0 ? { statedFacts: facts } : {}),
    };
  },

  exportBody(kase, run, format) {
    return financeExportBody({
      brief: run?.brief,
      artifactId: run?.artifactId,
      format,
      task: kase.task,
    });
  },
};
