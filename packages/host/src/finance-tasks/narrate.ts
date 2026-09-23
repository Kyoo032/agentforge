/**
 * The narration half of a Finance task: ask the model for the sections, then take every figure it
 * wrote back off it unless the task declared that figure.
 *
 * The model never sees the inputs — only `promptFacts` — and never gets the benefit of the doubt:
 * `guardNumbers` runs over each body against `allowedNumbers`, last, for every task.
 */
import { ApiError } from "@agentforge/core";
import {
  guardNumbers,
  type FinanceTaskProse,
  type FinanceTaskSection,
  type ReportLocale,
} from "@agentforge/core/finance";
import {
  GUARD_OUTSIDE_SECTIONS,
  guardAssumptions,
  guardLabel,
  guardTitle,
  type GuardReport,
} from "../finance-brief-build";
import { extractJsonObject } from "../presentation-outline";

export const FINANCE_TASK_SYSTEM = `You write the narrative for one DPSBuddy finance task. Every figure was computed in code and is listed for you; you add none.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": string,
  "sections": [{ "id": string, "heading": string, "body": string }],
  "assumptions": [string]
}
Rules:
- Write exactly one entry per requested section id, in the order requested, reusing that id verbatim.
- Every number in a body must be one of the facts listed below, written with the same value (rounding to one decimal is fine). Anything else is stripped by a guard and shown as "[unverified figure]", so do not estimate.
- If a fact you need is missing, say what input is missing instead of inventing it.
- Each body is 2 to 4 short paragraphs (\\n\\n between paragraphs). Headings are claims or jobs, not labels.
- assumptions: what the reader must accept for this to hold (periods, currency, what is excluded).
- No campus / student / course nouns unless the topic itself requires them.`;

const SECTION_CAP = 12;
const ASSUMPTION_CAP = 30;

export type NarrationSection = { readonly id: string; readonly heading: string; readonly body: string };

export type NarrationDraft = {
  readonly title: string;
  readonly sections: readonly NarrationSection[];
  readonly assumptions: readonly string[];
  /** The title to stand in when the model's cannot: none given, or one stating an untraced figure. */
  readonly fallbackTitle?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown, cap: number): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, cap) : [];
}

/** The sections the task declares, named for the reader. An empty list lets the model pick its own. */
export function sectionRequest(sections: readonly FinanceTaskSection[], locale: ReportLocale): string {
  if (sections.length === 0) {
    return locale === "id"
      ? "Bagian: pilih 3 sampai 6 bagian sendiri; pakai judulmu sebagai id."
      : "Sections: choose 3 to 6 of your own; use your heading as the id.";
  }
  const lines = sections.map((section) => `- ${section.id}: ${locale === "id" ? section.title.id : section.title.en}`);
  return `${locale === "id" ? "Bagian yang diminta, berurutan:" : "Sections requested, in order:"}\n${lines.join("\n")}`;
}

/** The model's JSON, read defensively. A section the task did not ask for is dropped, not renamed. */
export function parseNarration(
  raw: string,
  sections: readonly FinanceTaskSection[],
  fallbackTitle: string,
): NarrationDraft {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", "Model returned invalid JSON for the finance task", 502);
  }
  const wanted = sections.map((section) => section.id);
  const read = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { id: text(record.id), heading: text(record.heading), body: text(record.body) };
    })
    .filter((section) => section.heading && section.body)
    .slice(0, SECTION_CAP);
  const kept = wanted.length === 0 ? read : wanted.flatMap((id) => read.filter((section) => section.id === id));
  if (kept.length === 0) {
    throw new ApiError("invalid_finance", "Model returned no sections for this finance task", 502);
  }
  return {
    title: text(parsed.title) || fallbackTitle,
    sections: kept.map((section) => ({ ...section, id: section.id || section.heading })),
    assumptions: stringList(parsed.assumptions, ASSUMPTION_CAP),
    fallbackTitle,
  };
}

/**
 * The model's title, guarded. The fallback is the reader's own question, so a figure in it is theirs
 * to state; it is never counted against the model, whether it stands in or was there all along.
 */
function guardedTitle(draft: NarrationDraft, allowed: readonly number[]) {
  if (!draft.fallbackTitle) {
    return guardLabel(draft.title, allowed);
  }
  return draft.title === draft.fallbackTitle
    ? { text: draft.title, flagged: [] }
    : guardTitle(draft.title, allowed, draft.fallbackTitle);
}

/**
 * Prose with every unverified figure dealt with, and the tally the report shows as flags.
 *
 * A body keeps the marker, because the repair after this rewrites that section once and then takes
 * the sentence out. A title, a heading and an assumption are never rewritten, so their figure is
 * dealt with here: a title is replaced by the fallback, a heading loses the figure, an assumption
 * goes whole. The marker is never left in any of them.
 */
export function guardNarration(
  draft: NarrationDraft,
  allowed: readonly number[],
): {
  prose: FinanceTaskProse;
  guard: GuardReport;
} {
  const title = guardedTitle(draft, allowed);
  const guarded = draft.sections.map((section) => ({
    heading: guardLabel(section.heading, allowed),
    body: guardNumbers(section.body, allowed),
  }));
  const assumptions = guardAssumptions(draft.assumptions, allowed);
  const flagged = [
    ...title.flagged.map((text) => ({ section: GUARD_OUTSIDE_SECTIONS, text })),
    ...guarded.flatMap((result, index) => [
      ...result.heading.flagged.map((text) => ({ section: index, text })),
      ...result.body.flagged.map((token) => ({ section: index, text: token.text })),
    ]),
    ...assumptions.flagged.map((text) => ({ section: GUARD_OUTSIDE_SECTIONS, text })),
  ];
  return {
    prose: {
      title: title.text,
      sections: draft.sections.map((section, index) => ({
        id: section.id,
        heading: guarded[index]?.heading.text ?? section.heading,
        body: guarded[index]?.body.text ?? section.body,
      })),
      assumptions: assumptions.assumptions,
    },
    guard: { flagged, total: flagged.length, ...(assumptions.removed > 0 ? { removed: assumptions.removed } : {}) },
  };
}
