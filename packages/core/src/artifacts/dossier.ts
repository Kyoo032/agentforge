import { z } from "zod";

export const DOSSIER_VERSION = "dossier v1";
export const DOSSIER_SOURCE_STATUSES = ["read", "snippet", "unreachable"] as const;

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

export const dossierSchema = z.object({
  title: z.string().min(1),
  question: z.string().min(1),
  created: z.string().min(1),
  models: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
  sources: z.array(dossierSourceSchema).default([]),
  findings: z.array(dossierFindingSchema).default([]),
  contradictions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type DossierSource = z.infer<typeof dossierSourceSchema>;
export type DossierFinding = z.infer<typeof dossierFindingSchema>;
export type Dossier = z.infer<typeof dossierSchema>;

/** Fixed skeleton headings. Other modes navigate the Markdown by these. */
export const DOSSIER_HEADINGS = {
  question: "## Question",
  queries: "## Queries run",
  sources: "## Sources",
  findings: "## Findings",
  contradictions: "## Contradictions",
  openQuestions: "## Open questions",
} as const;

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

export function dossierToMarkdown(dossier: Dossier): string {
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
