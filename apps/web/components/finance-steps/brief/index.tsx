"use client";

/**
 * The financial brief's steps.
 *
 * Nothing new: this is today's inputs panel behind the shared props contract, and today's result
 * panel beside it. It is the reference the four task folders are written against — the panel itself
 * has not moved, so the brief on screen is exactly what it was.
 */
import type { DatasetSummary } from "@/lib/data-client";
import { mergeFigures } from "@/lib/finance-brief";
import {
  usableLineItems,
  usableStatedFacts,
  type FinanceParams,
  type LineItem,
  type StatedFact,
} from "@/lib/finance-client";
import { FinanceInputsPanel, type FinanceSource } from "../finance-inputs-panel";
import { FinanceResultPanel } from "../finance-result-panel";
import type { FinanceStepDraft, FinanceStepEntry, FinanceStepProps } from "../types";

/** The brief's own draft bag. The studio owns the state; this names the shape it hands over. */
export type BriefStepDraft = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: FinanceParams;
  readonly source: FinanceSource;
  readonly datasets: readonly DatasetSummary[];
  /** True while the pasted figures are being read into rows. */
  readonly parsing: boolean;
  /** A document's prose, kept so the parse can read the figures its tables never held. */
  readonly proseText: string;
  /** Those figures, once the parse has found them, for the owner to confirm or throw out. */
  readonly statedFacts: StatedFact[];
};

export function BriefInputs({ locked, draft, setDraft, onGenerate }: FinanceStepProps) {
  // The registry holds five tasks whose drafts have nothing in common, so each narrows its own once.
  const brief = draft as BriefStepDraft;
  return (
    <FinanceInputsPanel
      figures={brief.figures}
      // A second upload lands beside the first, prose included: two documents are one set of
      // figures here, and keeping only the last one's sentences would drop the first one's.
      onFigures={(value, prose) =>
        setDraft(
          prose === undefined
            ? { figures: value }
            : { figures: value, proseText: mergeFigures(brief.proseText, prose) },
        )
      }
      onParse={() => onGenerate({ kind: "parse" })}
      parsing={brief.parsing}
      locked={locked}
      datasets={brief.datasets}
      source={brief.source}
      onSource={(next) => setDraft({ source: next })}
      items={brief.items}
      onItems={(next) => setDraft({ items: next })}
      params={brief.params}
      onParams={(next) => setDraft({ params: next })}
      confirmedCount={usableLineItems(brief.items).length}
      statedFacts={brief.statedFacts}
      onStatedFacts={(next) => setDraft({ statedFacts: next })}
    />
  );
}

/** The state behind the brief's draft. The studio holds it; this folder knows how to write to it. */
export type BriefDraftSetters = {
  readonly setFigures: (value: string) => void;
  readonly setItems: (value: LineItem[]) => void;
  readonly setParams: (value: FinanceParams) => void;
  readonly setSource: (value: FinanceSource) => void;
  readonly setProseText: (value: string) => void;
  readonly setStatedFacts: (value: StatedFact[]) => void;
};

/** Everything the brief's own state holds. The studio owns the values; this folder shapes them. */
export type BriefState = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: FinanceParams;
  readonly source: FinanceSource;
  readonly datasets: readonly DatasetSummary[];
  readonly parsing: boolean;
  readonly proseText: string;
  readonly statedFacts: StatedFact[];
};

/** The bag the step components read. One object in, one object out: the studio stays a shell. */
export function briefDraftOf(state: BriefState): BriefStepDraft {
  return { ...state };
}

/**
 * The inputs half of every brief request: the rows (or the dataset they came from), the parameters,
 * and the figures the document stated in its own sentences. Those last ones are quoted and verified
 * by the host and are never added to anything — a stated fact is not an input to arithmetic.
 */
export function briefInputsBody(state: BriefState): Record<string, unknown> {
  const base =
    state.source.kind === "dataset"
      ? { datasetId: state.source.id, params: state.params }
      : { items: usableLineItems(state.items), params: state.params };
  const facts = usableStatedFacts(state.statedFacts);
  return { ...base, ...(facts.length > 0 ? { statedFacts: facts } : {}) };
}

/** A partial patch fanned out onto the studio's state. Fields left out are untouched. */
export function applyBriefDraft(patch: FinanceStepDraft, setters: BriefDraftSetters): void {
  const next = patch as Partial<BriefStepDraft>;
  if (next.figures !== undefined) {
    setters.setFigures(next.figures);
  }
  if (next.items !== undefined) {
    // Editing a row means the rows are the source again, the way the panel has always behaved.
    setters.setItems(next.items);
    setters.setSource({ kind: "items" });
  }
  if (next.params !== undefined) {
    setters.setParams(next.params);
  }
  if (next.source !== undefined) {
    setters.setSource(next.source);
  }
  if (next.proseText !== undefined) {
    setters.setProseText(next.proseText);
  }
  if (next.statedFacts !== undefined) {
    setters.setStatedFacts(next.statedFacts);
  }
}

export const BRIEF_STEPS: FinanceStepEntry = { Inputs: BriefInputs, Result: FinanceResultPanel };
