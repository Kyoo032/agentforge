/**
 * The pieces every task adapter is built from.
 *
 * An adapter's whole job is to answer three questions about ONE task, the way that
 * task's own step component answers them in the studio:
 *
 *   extractionRows(parsed)  what the parse proposed, as (label, period, amount)
 *   generateBody(kase, parsed)  the body the step posts to /finance/stream
 *   exportBody(kase, run, format)  the body its export menu posts
 *
 * The rule that runs through all of it: whatever the parse proposed is accepted
 * unchanged. The eval's contract is "the owner confirms without editing", so an
 * adapter that quietly repaired a row would be measuring a person who does not
 * exist.
 *
 * Pure. No network, no filesystem.
 */

/** A parse shape that cannot express `truth.lineItems` says so instead of scoring zero. */
export function unscorable(why, shapes) {
  return { rows: null, via: null, why, shapes: shapes ?? {} };
}

export function scorable(rows, via, extra = {}) {
  return { rows, via, why: null, shapes: {}, ...extra };
}

/** How many rows each shape the parse answered with is holding. Printed in the trace. */
export function shapeCounts(parsed) {
  const counts = {};
  for (const [key, value] of Object.entries(parsed ?? {})) {
    if (Array.isArray(value)) {
      counts[key] = value.length;
    }
  }
  return counts;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** `{ label, period, amount }` from a line-item-ish object, or null when it is not one. */
export function rowFromLineItem(item) {
  if (!item || typeof item !== "object" || typeof item.label !== "string" || item.label.trim() === "") {
    return null;
  }
  return finite(item.amount)
    ? { label: item.label, period: typeof item.period === "string" ? item.period : "", amount: item.amount }
    : null;
}

export function rowsFromLineItems(items) {
  return (Array.isArray(items) ? items : []).map(rowFromLineItem).filter((row) => row !== null);
}

/**
 * A labelled row with an `amounts: [{ period, amount }]` list — the shape the
 * cash-flow categories and both budget sides use — flattened one row per period.
 */
export function rowsFromPeriodSeries(entries) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const label = typeof entry?.label === "string" ? entry.label : "";
    if (label.trim() === "") {
      return [];
    }
    return (Array.isArray(entry.amounts) ? entry.amounts : []).flatMap((cell) =>
      finite(cell?.amount)
        ? [{ label, period: typeof cell.period === "string" ? cell.period : "", amount: cell.amount }]
        : [],
    );
  });
}

/** The params a case declares, sent as the studio's parameters panel would send them. */
export function paramsOf(kase) {
  return kase?.params && typeof kase.params === "object" ? kase.params : {};
}

/**
 * The export body, exactly as `apps/web/lib/finance-export.ts:financeExportBody`
 * builds it: the report when a task computed one, the brief when the brief did.
 */
export function financeExportBody({ report, brief, artifactId, format, task }) {
  return {
    ...(report ? { report } : {}),
    ...(brief ? { brief } : {}),
    format,
    ...(artifactId ? { artifactId } : {}),
    ...(task ? { task } : {}),
  };
}
