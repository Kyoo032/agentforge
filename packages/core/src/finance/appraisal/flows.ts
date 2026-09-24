/**
 * Confirmed rows to one net cash flow per year, with the rows that make it still visible.
 *
 * Two mistakes decide whether an appraisal is right at all, and both live here. The first is adding
 * a `Arus kas bersih` / `Net cash flow` subtotal to the component rows it totals, which doubles
 * every year; a subtotal is therefore caught by name AND arithmetically, and a row that only looks
 * like one survives. The second is losing the order of the periods, which discounts the wrong flow
 * by the wrong power — so ordinals decide the order whenever every label carries one, and first
 * appearance decides it only when none does.
 */
import type { LineItem } from "../types";
import { allPeriodsOrdinal, periodOrdinal } from "./periods";

/** One row behind a year's net flow, kept so the reader can see what the net is made of. */
export type AppraisalComponent = {
  readonly label: string;
  readonly amount: number;
  readonly category: string;
};

/** One year on the timeline: its label, its position, its net flow and the rows behind it. */
export type AppraisalYearFlow = {
  readonly period: string;
  readonly year: number;
  readonly net: number;
  readonly components: readonly AppraisalComponent[];
};

/** Subtotal names, in both languages. Matched on the whole label, after the importer's own tag. */
const SUBTOTAL_NAME =
  /^(?:\[subtotal\]\s*)?(?:arus\s+kas\s+bersih|kas\s+bersih|total|jumlah|subtotal|net\s+cash\s+flow|net\s+cash|total\s+cash\s+flow|net\s+flow)\b/i;

/** The importer's own marker for a row it already recognised as a total. */
const SUBTOTAL_TAG = /^\s*\[subtotal\]\s*/i;

/** A subtotal matches its parts to within this share of itself; floats, not names, decide ties. */
const SUBTOTAL_TOLERANCE = 1e-6;

function sumOf(items: readonly LineItem[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

/** True when this row equals the sum of the other rows sharing its period, within tolerance. */
function totalsItsPeers(item: LineItem, peers: readonly LineItem[]): boolean {
  if (peers.length < 2) {
    return false;
  }
  const total = sumOf(peers);
  const scale = Math.max(Math.abs(total), Math.abs(item.amount), 1);
  return Math.abs(total - item.amount) <= scale * SUBTOTAL_TOLERANCE;
}

/**
 * Rows that restate their neighbours, removed.
 *
 * Name alone is not enough — a genuine row called "Total savings" would be dropped — and arithmetic
 * alone is not enough either, because a two-row year where one row happens to equal the other's sum
 * is a coincidence, not a total. Both must agree, except for the importer's own `[subtotal]` tag,
 * which is the sheet saying so outright.
 */
export function dropSubtotalRows(items: readonly LineItem[]): LineItem[] {
  return items.filter((item) => {
    const tagged = SUBTOTAL_TAG.test(item.label);
    if (!tagged && !SUBTOTAL_NAME.test(item.label.trim())) {
      return true;
    }
    const peers = items.filter((other) => other !== item && other.period === item.period);
    return tagged ? false : !totalsItsPeers(item, peers);
  });
}

/** The label without the importer's `[subtotal]` tag, so nothing downstream shows our own marker. */
export function componentLabel(label: string): string {
  return label.replace(SUBTOTAL_TAG, "").trim();
}

/** True when the sheet itself marked this row as a total — the one claim we take at face value. */
export function isTaggedSubtotal(label: string): boolean {
  return SUBTOTAL_TAG.test(label);
}

/** True when the label reads like a total. On its own this is a suspicion, never a verdict. */
export function isSubtotalLabel(label: string): boolean {
  return isTaggedSubtotal(label) || SUBTOTAL_NAME.test(label.trim());
}

type Bucket = { period: string; seen: number; items: LineItem[] };

function bucketByPeriod(items: readonly LineItem[]): Bucket[] {
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();
  for (const item of items) {
    const existing = buckets.get(item.period);
    if (existing) {
      existing.items.push(item);
    } else {
      buckets.set(item.period, { period: item.period, seen: order.length, items: [item] });
      order.push(item.period);
    }
  }
  return order.map((period) => buckets.get(period) as Bucket);
}

function componentOf(item: LineItem): AppraisalComponent {
  return { label: componentLabel(item.label), amount: item.amount, category: item.category };
}

const ENGLISH_ORDINAL_SUFFIX = /(\d+)(?:st|nd|rd|th)\b/i;

function englishSuffix(ordinal: number): string {
  const lastTwo = ordinal % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return "th";
  }
  return ["th", "st", "nd", "rd"][ordinal % 10] ?? "th";
}

/**
 * A missing year's label, written the way the sheet writes its neighbour: "Tahun 1" beside "Tahun 0",
 * "Tahun ke-2" beside "Tahun ke-1", "3rd year" beside "2nd year". The ordinal is the only digit run
 * an ordinal label carries, so it is the only thing replaced.
 */
function periodLike(neighbour: string, ordinal: number): string {
  return ENGLISH_ORDINAL_SUFFIX.test(neighbour)
    ? neighbour.replace(ENGLISH_ORDINAL_SUFFIX, `${ordinal}${englishSuffix(ordinal)}`)
    : neighbour.replace(/\d+/, String(ordinal));
}

/**
 * The ordinal years with every gap between the first and the last filled by a year of nothing.
 *
 * Every discounting function reads a flow's position in the array as its power, so the array has to
 * hold every year: the grid keeps no row for a zero cell, and a year whose cells were all zero would
 * otherwise vanish and pull every later year one power closer to today.
 */
function withMissingYears(flows: readonly AppraisalYearFlow[]): AppraisalYearFlow[] {
  const filled: AppraisalYearFlow[] = [];
  for (const flow of flows) {
    const previous = filled.at(-1);
    if (previous) {
      for (let year = previous.year + 1; year < flow.year; year += 1) {
        filled.push({ period: periodLike(previous.period, year), year, net: 0, components: [] });
      }
    }
    filled.push(flow);
  }
  return filled;
}

/**
 * One net flow per period, ordered by the ordinal its label carries.
 *
 * A period whose rows are all zero still gets a year: an appraisal with a hole in the middle is a
 * different plan from one that ends early, and the cumulative line has to show it. When every label
 * carries an ordinal, a year with no rows at all is put back at zero for the same reason.
 */
export function appraisalFlowsFromItems(items: readonly LineItem[]): AppraisalYearFlow[] {
  const rows = dropSubtotalRows(items).filter((item) => Number.isFinite(item.amount));
  const buckets = bucketByPeriod(rows);
  const ordinal = allPeriodsOrdinal(buckets.map((bucket) => bucket.period));
  const ordered = ordinal
    ? [...buckets].sort((left, right) => (periodOrdinal(left.period) ?? 0) - (periodOrdinal(right.period) ?? 0))
    : buckets;
  const flows = ordered.map((bucket, index) => ({
    period: bucket.period,
    year: periodOrdinal(bucket.period) ?? index,
    net: sumOf(bucket.items),
    components: bucket.items.map(componentOf),
  }));
  return ordinal ? withMissingYears(flows) : flows;
}

/** The net flows alone, in timeline order — what every discounting function takes. */
export function netFlowsOf(flows: readonly AppraisalYearFlow[]): number[] {
  return flows.map((flow) => flow.net);
}

/**
 * The initial outlay: the flow at t = 0. Reported as it stands — negative for a real investment —
 * so a plan whose first year is already positive is visible rather than silently made negative.
 */
export function outlayOf(flows: readonly AppraisalYearFlow[]): number | null {
  const first = flows.find((flow) => flow.year === 0) ?? flows[0];
  return first ? first.net : null;
}

/** The years whose net flow is negative after t = 0 — the mid-life reversals a memo must name. */
export function negativeYearsOf(flows: readonly AppraisalYearFlow[]): AppraisalYearFlow[] {
  return flows.filter((flow, index) => index > 0 && flow.net < 0);
}
