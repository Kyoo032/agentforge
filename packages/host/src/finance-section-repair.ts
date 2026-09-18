/**
 * What happens after the guard finds a figure it cannot trace.
 *
 * Leaving "[unverified figure]" in the finished report tells the owner the app caught itself, and
 * then makes them fix it. So the section is asked for once more — with the offending sentence quoted
 * back and the facts it may use listed — and if the marker survives that, the sentence is taken out
 * cleanly and the report says one sentence was removed. The reader never sees the marker; they see
 * a report that is short by one sentence and a flag that says why.
 */
import { UNVERIFIED_MARKER, type ComputedFinance } from "@agentforge/core/finance";
import type { FinanceBrief, FinanceSection } from "@agentforge/core/artifacts";
import type { AppLocale, TenantContext } from "@agentforge/core";
import { collectJobAssistantRun } from "./job-regen";
import { guardSection, parseBriefSection, type GuardReport } from "./finance-brief-build";

/** Sentence boundaries that survive "Rp 1.250.000.000" — a full stop between digits is not one. */
const SENTENCE_END = /(?<![0-9])([.!?])\s+(?=[A-ZÀ-ÖØ-Þ"“(])/g;

export type RepairPrompt = {
  readonly tenant: TenantContext;
  readonly model: string;
  readonly systemPrompt: string;
  readonly factsBlock: string;
  readonly locale: AppLocale;
};

/** Split on sentence ends only where a capital follows, so grouped figures stay whole. */
export function splitSentences(body: string): string[] {
  return body
    .replace(SENTENCE_END, "$1\u0000")
    .split("\u0000")
    .filter((sentence) => sentence.trim() !== "");
}

export type StrippedBody = { readonly body: string; readonly removed: string[] };

/** Every sentence still carrying the marker, taken out; paragraphs that empty out go with them. */
export function stripMarkedSentences(body: string): StrippedBody {
  const removed: string[] = [];
  const paragraphs = body.split(/\n{2,}/).map((paragraph) => {
    const kept = splitSentences(paragraph).filter((sentence) => {
      if (!sentence.includes(UNVERIFIED_MARKER)) {
        return true;
      }
      removed.push(sentence.trim());
      return false;
    });
    return kept.join(" ").replace(/\s+/g, " ").trim();
  });
  return { body: paragraphs.filter(Boolean).join("\n\n"), removed };
}

function offendingSentences(body: string): string[] {
  return splitSentences(body)
    .filter((sentence) => sentence.includes(UNVERIFIED_MARKER))
    .map((sentence) => sentence.trim());
}

const RETRY_INSTRUCTION: Record<AppLocale, string> = {
  en: "One sentence used a figure that is not in the facts above, so it was blanked out. Rewrite this section and restate that point using only the listed facts, or drop the point. Do not write the marker itself.",
  id: "Satu kalimat memakai angka yang tidak ada di daftar fakta di atas, jadi angkanya dihapus. Tulis ulang bagian ini dan sampaikan poin itu hanya dengan angka yang terdaftar, atau hilangkan poinnya. Jangan menulis penanda itu sendiri.",
};

async function rewriteOnce(
  prompt: RepairPrompt,
  section: FinanceSection,
  offending: readonly string[],
): Promise<FinanceSection | null> {
  try {
    const run = await collectJobAssistantRun({
      tenant: prompt.tenant,
      model: prompt.model,
      systemPrompt: prompt.systemPrompt,
      runPrefix: "finance-repair",
      agentId: "finance",
      jobMode: "finance",
      versionId: "finance-repair",
      prompt: [
        prompt.factsBlock,
        `${RETRY_INSTRUCTION[prompt.locale] ?? RETRY_INSTRUCTION.en}`,
        `The sentence that failed:\n${offending.join("\n")}`,
        `Rewrite this section only.\nHeading: ${section.heading}\nBody:\n${section.body}`,
      ].join("\n\n"),
    });
    return { ...section, ...parseBriefSection(run.text) };
  } catch {
    // A model that cannot answer the retry is not a reason to lose the brief; the strip below stands.
    return null;
  }
}

export type RepairResult = { readonly brief: FinanceBrief; readonly guard: GuardReport };

/**
 * One retry per marked section, then a clean removal. `guard.removed` is what the report turns into
 * the "a sentence was removed" flag.
 */
export async function repairUnverifiedSections(
  brief: FinanceBrief,
  computed: ComputedFinance,
  prompt: RepairPrompt,
): Promise<RepairResult> {
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const flagged: GuardReport["flagged"] = [];
  let removed = 0;
  const sections: FinanceSection[] = [];
  for (const [index, section] of brief.sections.entries()) {
    const offending = offendingSentences(section.body);
    if (offending.length === 0) {
      sections.push(section);
      continue;
    }
    const retried = await rewriteOnce(prompt, section, offending);
    const guarded = retried ? guardSection(retried, computed, knownKeys) : null;
    const candidate = guarded?.section ?? section;
    for (const text of guarded?.flagged ?? []) {
      flagged.push({ section: index, text });
    }
    const stripped = stripMarkedSentences(candidate.body);
    removed += stripped.removed.length;
    sections.push({ ...candidate, body: stripped.body });
  }
  return { brief: { ...brief, sections }, guard: { flagged, total: flagged.length, removed } };
}
