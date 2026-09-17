/**
 * One statement row to one bucket, deterministically, with the evidence attached.
 *
 * Nothing here asks a model. The order is: a row the importer already marked as a total is excluded,
 * then the label dictionary, then the section heading the importer kept, then the brief's own
 * line-item category, and only then "I could not place this". Every answer carries the rule that
 * produced it and a confidence, because the studio shows the whole table back to the reader before a
 * single ratio is computed — a silent misclassification is the one failure this task cannot survive.
 *
 * The host's parse hook may hand leftovers to a model afterwards; that answer arrives here as an
 * `override` like any other, and is shown with its own, lower confidence.
 */
import { z } from "zod";
import { DERIVED_TAG } from "../import-table";
import type { LineItemCategory } from "../types";
import { isRatioBucket, ratioBucketSchema, type RatioBucket } from "./buckets";
import {
  RATIO_CATEGORY_CONFIDENCE,
  RATIO_LABEL_RULES,
  RATIO_SECTION_CONFIDENCE,
  RATIO_SECTION_RULES,
  RATIO_UNKNOWN_CONFIDENCE,
} from "./classify-rules";

export const RATIO_CLASSIFY_SOURCES = [
  "derived",
  "label",
  "section",
  "category",
  "model",
  "override",
  // A row this task added back because a printed subtotal determined it — see `./reconcile.ts`.
  "reconciled",
  "unknown",
] as const;
export type RatioClassifySource = (typeof RATIO_CLASSIFY_SOURCES)[number];

/** `[ASET / Aset Lancar] Kas dan Setara Kas` — the section the importer kept, ahead of the label. */
const SECTION_TAG = /^\s*\[([^\]]*)\]\s*/;

export type RatioRowInput = {
  readonly label: string;
  readonly period?: string;
  readonly amount: number;
  readonly currency?: string;
  readonly category?: LineItemCategory;
  /** The importer's section path, when the row came through a spreadsheet. */
  readonly section?: string;
  /** True when the importer marked this row a subtotal or total. */
  readonly derived?: boolean;
};

export type RatioClassification = {
  readonly bucket: RatioBucket;
  /** 0 to 1. What the evidence is worth, never what the company is worth. */
  readonly confidence: number;
  readonly source: RatioClassifySource;
  /** The rule id behind the answer, shown in the studio so a reader can disagree with it by name. */
  readonly reason: string;
};

/** One row, its bucket, and why — the row the studio renders and the maths then reads. */
export type ClassifiedRatioRow = RatioRowInput & RatioClassification;

/** A bucket the reader (or the model) chose, keyed by the row it belongs to. */
export const ratioBucketOverrideSchema = z.object({
  label: z.string().min(1),
  period: z.string().default(""),
  bucket: ratioBucketSchema,
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["model", "override"]).default("override"),
});

export type RatioBucketOverride = z.infer<typeof ratioBucketOverrideSchema>;

/** Lowercase, punctuation flattened to single spaces. Every pattern in the dictionary assumes this. */
export function normalizeRatioLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** `[subtotal] [ASET / Aset Lancar] Kas dan Setara Kas` split into its three facts. */
export function readImportedLabel(raw: string): { label: string; section: string; derived: boolean } {
  const trimmed = raw.trim();
  const derived = trimmed.startsWith(DERIVED_TAG);
  const withoutTag = derived ? trimmed.slice(DERIVED_TAG.length).trim() : trimmed;
  const match = SECTION_TAG.exec(withoutTag);
  return {
    label: (match ? withoutTag.slice(match[0].length) : withoutTag).trim(),
    section: match?.[1]?.trim() ?? "",
    derived,
  };
}

function byLabel(label: string): RatioClassification | null {
  const flat = normalizeRatioLabel(label);
  for (const rule of RATIO_LABEL_RULES) {
    if (rule.pattern.test(flat) && !(rule.veto?.test(flat) ?? false)) {
      return { bucket: rule.bucket, confidence: rule.confidence, source: "label", reason: rule.id };
    }
  }
  return null;
}

function bySection(section: string): RatioClassification | null {
  const flat = normalizeRatioLabel(section);
  if (flat === "") {
    return null;
  }
  const rule = RATIO_SECTION_RULES.find((entry) => entry.pattern.test(flat));
  return rule
    ? { bucket: rule.bucket, confidence: RATIO_SECTION_CONFIDENCE, source: "section", reason: rule.id }
    : null;
}

/** The brief's nine categories are coarser than these buckets, so this is evidence of last resort. */
const FROM_CATEGORY: Readonly<Partial<Record<LineItemCategory, RatioBucket>>> = Object.freeze({
  revenue: "revenue",
  cogs: "cogs",
  opex: "opex",
  cash: "cash",
  debt: "long-term-debt",
  equity: "equity",
  asset: "other-current-asset",
  liability: "current-liability",
});

function byCategory(category: LineItemCategory | undefined): RatioClassification | null {
  const bucket = category ? FROM_CATEGORY[category] : undefined;
  return bucket
    ? { bucket, confidence: RATIO_CATEGORY_CONFIDENCE, source: "category", reason: `category:${category}` }
    : null;
}

/** Where one row belongs, and on what evidence. Never throws: an unplaceable row is `excluded`. */
export function classifyRatioRow(row: RatioRowInput): RatioClassification {
  if (row.derived === true) {
    return { bucket: "excluded", confidence: 0.99, source: "derived", reason: "importer:subtotal" };
  }
  return (
    byLabel(row.label) ??
    bySection(row.section ?? "") ??
    byCategory(row.category) ?? {
      bucket: "excluded",
      confidence: RATIO_UNKNOWN_CONFIDENCE,
      source: "unknown",
      reason: "no-rule-matched",
    }
  );
}

function overrideKey(label: string, period: string): string {
  return `${normalizeRatioLabel(label)}|${period.trim().toLowerCase()}`;
}

/**
 * Every row classified, with the reader's own choices laid over the top.
 *
 * An override with an empty period applies to every period of that label, which is what the studio's
 * one-row-per-label table means when the reader picks a bucket for `Persediaan`.
 */
export function classifyRatioRows(
  rows: readonly RatioRowInput[],
  overrides: readonly RatioBucketOverride[] = [],
): readonly ClassifiedRatioRow[] {
  const byPeriod = new Map(overrides.map((entry) => [overrideKey(entry.label, entry.period), entry]));
  const byLabelOnly = new Map(
    overrides.filter((entry) => entry.period.trim() === "").map((entry) => [normalizeRatioLabel(entry.label), entry]),
  );
  return rows.map((row) => {
    const chosen =
      byPeriod.get(overrideKey(row.label, row.period ?? "")) ?? byLabelOnly.get(normalizeRatioLabel(row.label));
    if (chosen && isRatioBucket(chosen.bucket)) {
      return {
        ...row,
        bucket: chosen.bucket,
        confidence: chosen.confidence ?? (chosen.source === "model" ? 0.5 : 1),
        source: chosen.source,
        reason: chosen.source === "model" ? "model:leftover" : "reader:confirmed",
      };
    }
    return { ...row, ...classifyRatioRow(row) };
  });
}

/** The rows nothing could place. These are what a model is asked about, and what the studio asks for. */
export function unplacedRatioRows(rows: readonly ClassifiedRatioRow[]): readonly ClassifiedRatioRow[] {
  return rows.filter((row) => row.bucket === "excluded" && row.source === "unknown");
}
