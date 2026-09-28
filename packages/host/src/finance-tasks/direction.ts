/**
 * A sentence that quotes a computed figure and says the opposite of its direction.
 *
 * The number guard already ran. This check does not look for a new amount: the task listed the
 * figures whose direction the code decided, and a sentence that quotes one of them while saying
 * the opposite is sent back once, then dropped. A sentence that quotes two directions is left
 * alone. The marker from the number guard is not used here — that rewrite asks for a missing
 * figure, and this one asks for the direction the code already computed.
 */
import { withOutputLanguage } from "@agentforge/core";
import {
  contradictingSentences,
  guardNumbers,
  withoutContradictingSentences,
  type DirectionClaim,
  type ReportLocale,
} from "@agentforge/core/finance";
import type { JobEmitter } from "@agentforge/core/jobs";
import { stripMarkedSentences } from "../finance-section-repair";
import { collectJobAssistantRun } from "../job-regen";
import { extractJsonObject } from "../presentation-outline";
import type { FinanceTaskRunContext } from "./types";

/** What a section says when every sentence in it contradicted a computed direction. No figure. */
export const DIRECTION_EMPTY: Readonly<Record<ReportLocale, string>> = Object.freeze({
  en: "The text of this section was removed because it said the opposite of a computed figure.",
  id: "Teks bagian ini dihapus karena isinya berlawanan dengan angka yang sudah dihitung.",
});

const DIRECTION_SYSTEM = `You rewrite one section of a DPSBuddy finance report.
Return ONLY valid JSON (no markdown fences) with this exact shape: { "heading": string, "body": string }
Rules:
- Every number in the body must be one of the facts listed above, written with the same value. Add none.
- Keep the direction those facts already state. Do not say the opposite of a figure you quote.
- Keep the section on its own topic: 2 to 4 short paragraphs, "\\n\\n" between them.`;

const RETRY: Readonly<Record<ReportLocale, string>> = Object.freeze({
  en: "One sentence quoted a computed figure and said the opposite of the direction the code already decided. Rewrite this section so every quoted figure keeps that direction, or drop the sentence.",
  id: "Satu kalimat mengutip angka yang sudah dihitung dan mengatakan arah yang berlawanan. Tulis ulang bagian ini agar setiap angka yang dikutip mengikuti arah itu, atau hilangkan kalimatnya.",
});

export type DirectionSection = { readonly heading: string; readonly body: string };

export type DirectionHoldOptions = {
  readonly tenant: FinanceTaskRunContext["tenant"];
  readonly model: string;
  readonly locale: ReportLocale;
  readonly factsBlock: string;
  readonly allowed: readonly number[];
  readonly emit: JobEmitter;
  readonly phase: string;
};

export type DirectionHoldResult<S extends DirectionSection> = {
  readonly sections: S[];
  /** Sentences still saying the opposite after the one rewrite, then taken out. */
  readonly directionRemoved: number;
  /** Sentences the number guard took out of the rewrite. Not a direction failure. */
  readonly amountRemoved: number;
};

function readRewrite(raw: string): string | null {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    return body || null;
  } catch {
    return null;
  }
}

/**
 * One rewrite of each section that contradicts a claim, then those sentences go.
 *
 * No claim, or no contradicting sentence, asks nothing of the model. The heading the task
 * already had is kept: the rewrite is only the body.
 */
export async function holdReadingDirection<S extends DirectionSection>(
  sections: readonly S[],
  claims: readonly DirectionClaim[],
  options: DirectionHoldOptions,
): Promise<DirectionHoldResult<S>> {
  const quiet = { sections: [...sections], directionRemoved: 0, amountRemoved: 0 };
  if (claims.length === 0) {
    return quiet;
  }
  const hit = sections.some((section) => contradictingSentences(section.body, claims, options.locale).length > 0);
  if (!hit) {
    return quiet;
  }
  options.emit({
    type: "job.step",
    phase: options.phase,
    label: "Reading contradicted a computed direction",
  });
  let directionRemoved = 0;
  let amountRemoved = 0;
  const next: S[] = [];
  for (const section of sections) {
    if (contradictingSentences(section.body, claims, options.locale).length === 0) {
      next.push(section);
      continue;
    }
    const run = await collectJobAssistantRun({
      tenant: options.tenant,
      model: options.model,
      systemPrompt: withOutputLanguage(DIRECTION_SYSTEM, "finance", options.locale),
      runPrefix: "finance-direction",
      agentId: "finance",
      jobMode: "finance",
      versionId: "finance-direction",
      prompt: [options.factsBlock, RETRY[options.locale], `Section:\n${section.heading}\n\n${section.body}`]
        .filter(Boolean)
        .join("\n\n"),
    });
    const rewritten = readRewrite(run.text) ?? section.body;
    const guarded = guardNumbers(rewritten, options.allowed);
    const stripped = stripMarkedSentences(guarded.text);
    amountRemoved += stripped.removed.length;
    const direction = withoutContradictingSentences(stripped.body, claims, options.locale);
    directionRemoved += direction.removed.length;
    const note = DIRECTION_EMPTY[options.locale];
    const body = direction.body.trim() ? direction.body : note;
    next.push({ ...section, heading: section.heading, body });
  }
  if (directionRemoved > 0) {
    options.emit({
      type: "job.step",
      phase: options.phase,
      label: `${directionRemoved} sentence(s) removed because they contradicted a computed direction`,
    });
  }
  return { sections: next, directionRemoved, amountRemoved };
}
