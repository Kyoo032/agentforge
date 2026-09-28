import { z } from "zod";
import { parseAppLocale, type AppLocale } from "../locale";

export const DOSSIER_VERSION = "dossier v1";
export const DOSSIER_SOURCE_STATUSES = ["read", "snippet", "unreachable"] as const;
export const COMPARISON_VERDICTS = ["agree", "contradict", "only"] as const;

export const dossierSourceSchema = z.object({
  /** Stable id used in citations: S1, S2, ... */
  id: z.string().regex(/^S\d+$/),
  title: z.string().default(""),
  url: z.string().default(""),
  retrievedAt: z.string().default(""),
  foundBy: z.string().default(""),
  status: z.enum(DOSSIER_SOURCE_STATUSES).default("snippet"),
  passages: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export const dossierFindingSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  sources: z.array(z.string().regex(/^S\d+$/)).default([]),
});

export const comparisonRowSchema = z.object({
  claim: z.string().min(1),
  verdict: z.enum(COMPARISON_VERDICTS),
  sources: z.array(z.string().regex(/^S\d+$/)).min(1),
});

export const dossierSchema = z.object({
  title: z.string().min(1),
  question: z.string().min(1),
  created: z.string().min(1),
  models: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
  sources: z.array(dossierSourceSchema).default([]),
  findings: z.array(dossierFindingSchema).default([]),
  comparison: z.array(comparisonRowSchema).default([]),
  contradictions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type DossierSource = z.infer<typeof dossierSourceSchema>;
export type DossierFinding = z.infer<typeof dossierFindingSchema>;
export type ComparisonVerdict = (typeof COMPARISON_VERDICTS)[number];
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;
export type Dossier = z.infer<typeof dossierSchema>;

/** Fixed skeleton headings. Other modes navigate the Markdown by these. */
export const DOSSIER_HEADINGS = {
  question: "## Question",
  queries: "## Queries run",
  sources: "## Sources",
  findings: "## Findings",
  comparison: "## Comparison",
  contradictions: "## Contradictions",
  openQuestions: "## Open questions",
} as const;

/**
 * Verdict phrases for a comparison row. Mirrors `verdictAgree`, `verdictContradict`, and
 * `verdictOnly` in `apps/web/locales/{en,id}/research.json`. The heading stays English:
 * other modes navigate the dossier by `DOSSIER_HEADINGS`.
 */
const COMPARISON_VERDICT_LABELS: Record<AppLocale, Record<ComparisonVerdict, string>> = {
  en: {
    agree: "Sources agree",
    contradict: "Sources contradict",
    only: "Only one source says it",
  },
  id: {
    agree: "Sumber sepakat",
    contradict: "Sumber bertentangan",
    only: "Hanya satu sumber yang menyebutnya",
  },
};

const SOURCE_TITLE_SEPARATOR = " — ";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(dossier: Dossier): string[] {
  return [
    "---",
    `question: ${yamlString(dossier.question)}`,
    `created: ${yamlString(dossier.created)}`,
    `models: [${dossier.models.map(yamlString).join(", ")}]`,
    `queries: [${dossier.queries.map(yamlString).join(", ")}]`,
    `sourceCount: ${dossier.sources.length}`,
    `agentforge: ${yamlString(DOSSIER_VERSION)}`,
    "---",
  ];
}

function sourceBlock(source: DossierSource): string[] {
  const lines = [
    `### ${source.id}${SOURCE_TITLE_SEPARATOR}${source.title || source.url || "Untitled"}`,
    "",
    `- URL: ${source.url || "(none)"}`,
    `- Retrieved: ${source.retrievedAt || "(unknown)"}`,
    `- Found by query: ${source.foundBy || "(unknown)"}`,
    `- Status: ${source.status}`,
    "",
  ];
  if (source.passages.length > 0) {
    lines.push("Key passages:", "", ...source.passages.map((passage) => `> ${passage.replace(/\r?\n/g, " ")}`), "");
  }
  if (source.notes) {
    lines.push(`Notes: ${source.notes}`, "");
  }
  return lines;
}

function findingBlock(finding: DossierFinding): string[] {
  const cites = finding.sources.length > 0 ? ` ${finding.sources.map((id) => `[${id}]`).join("")}` : "";
  return [`### ${finding.heading}`, "", `${finding.body}${cites}`, ""];
}

function bulletList(items: string[], empty: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`];
}

function comparisonBlock(rows: readonly ComparisonRow[], locale: AppLocale): string[] {
  const labels = COMPARISON_VERDICT_LABELS[locale];
  const items = rows.map(
    (row) => `${row.claim} — ${labels[row.verdict]} ${row.sources.map((id) => `[${id}]`).join("")}`,
  );
  return bulletList(items, "None recorded.");
}

export function dossierToMarkdown(dossier: Dossier, locale?: AppLocale): string {
  const desk = parseAppLocale(locale ?? "en");
  const lines = [
    ...frontmatter(dossier),
    `# ${dossier.title}`,
    "",
    DOSSIER_HEADINGS.question,
    "",
    dossier.question,
    "",
    DOSSIER_HEADINGS.queries,
    "",
    ...bulletList(dossier.queries, "(none)"),
    "",
    DOSSIER_HEADINGS.sources,
    "",
    ...dossier.sources.flatMap(sourceBlock),
    DOSSIER_HEADINGS.findings,
    "",
    ...dossier.findings.flatMap(findingBlock),
    DOSSIER_HEADINGS.comparison,
    "",
    ...comparisonBlock(dossier.comparison ?? [], desk),
    "",
    DOSSIER_HEADINGS.contradictions,
    "",
    ...bulletList(dossier.contradictions, "None recorded."),
    "",
    DOSSIER_HEADINGS.openQuestions,
    "",
    ...bulletList(dossier.openQuestions, "None recorded."),
  ];
  return `${lines.join("\n").trim()}\n`;
}

/** Ids cited anywhere in a body of text, e.g. `[S3]`. */
export function citedSourceIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\[(S\d+)\]/g)) {
    ids.add(match[1] ?? "");
  }
  return [...ids].filter(Boolean);
}
