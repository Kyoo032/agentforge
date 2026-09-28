import { ApiError, parseAppLocale, type AppLocale } from "@agentforge/core";
import {
  citedSourceIds,
  dossierSchema,
  type Dossier,
  type DossierFinding,
  type DossierSource,
  type ResearchNotes,
} from "@agentforge/core/artifacts";
import type { JobEmitter } from "@agentforge/core/jobs";
import { throwIfJobAborted } from "./job-stream";
import { extractJsonObject } from "./presentation-outline";

/** Fixed caps for the closed beta ("fully detailed" never means unbounded). */
export type ResearchCaps = {
  maxQueries: number;
  hitsPerQuery: number;
  maxPages: number;
  pageChars: number;
  readConcurrency: number;
  maxPassagesPerSource: number;
};

/** Same floor `parseExtraction` uses. A shorter string is not a passage a finding may cite. */
const PASSAGE_MIN = 20;

/**
 * Host copy for the citation check. Mirrors `phaseChecking`, `errorNoPassage`, and `citeGap`
 * in `apps/web/locales/{en,id}/research.json`. The host does not import those catalogs.
 */
const RESEARCH_HOST_COPY: Record<
  AppLocale,
  { checking: string; noPassage: string; citeGap: (heading: string) => string }
> = {
  en: {
    checking: "Checking citations",
    noPassage: "No page kept a sentence that can be cited.",
    citeGap: (heading) => `Could not cite a kept passage: ${heading}`,
  },
  id: {
    checking: "Memeriksa kutipan",
    noPassage: "Tidak ada halaman yang menyimpan kalimat yang dapat dikutip.",
    citeGap: (heading) => `Tidak ada kutipan yang tersimpan untuk: ${heading}`,
  },
};

export const RESEARCH_CAPS: ResearchCaps = {
  maxQueries: 5,
  hitsPerQuery: 5,
  maxPages: 10,
  pageChars: 8_000,
  readConcurrency: 3,
  maxPassagesPerSource: 5,
};

export type SearchHit = { title?: string; url?: string; description?: string };
export type PageRead = { title: string; text: string; truncated: boolean };

export type DossierDeps = {
  /** Model call: system prompt + user prompt → raw assistant text. */
  ask: (system: string, prompt: string) => Promise<string>;
  search: (query: string) => Promise<SearchHit[]>;
  readPage: (url: string) => Promise<PageRead>;
  emit?: JobEmitter;
  abortSignal?: AbortSignal;
  now?: () => Date;
  caps?: Partial<ResearchCaps>;
  /** Desk locale for the citation-check labels. Model prose still goes through `withOutputLanguage`. */
  locale?: AppLocale;
};

export type DossierRunInput = { question: string; models: string[] };

export type DossierRunResult = { dossier: Dossier; notes: ResearchNotes };

export const PLAN_SYSTEM = `You plan web research. Given a question, return ONLY JSON: {"queries": string[]}.
Rules: 3 to 5 distinct search queries that together cover the question (definitions, numbers, opposing views, recent developments). Short keyword queries, no quotes, no numbering. Same language as the question.`;

export const EXTRACT_SYSTEM = `You extract evidence from one web page for a research dossier. Return ONLY JSON:
{"passages": string[], "notes": string}
Rules:
- passages: up to 5 sentences copied VERBATIM from the page text that bear on the question. Do not paraphrase, do not merge sentences, do not add words.
- notes: one or two lines on why this source matters and how much to trust it (who published it, date if visible, marketing vs. data).
- If the page says nothing relevant, return {"passages": [], "notes": "Not relevant: <why>"}.`;

export const SYNTHESIS_SYSTEM = `You write the findings section of a research dossier from numbered sources. Return ONLY JSON:
{
  "title": string,
  "summary": string,
  "findings": [{ "heading": string, "body": string, "sources": string[] }],
  "contradictions": string[],
  "openQuestions": string[]
}
Rules:
- Use only the passages and notes given. Every finding cites its sources as [S1], [S2] inside body AND lists the same ids in sources.
- 4 to 8 findings. Each is one claim or cluster: evidence, disagreement or gap, and what it implies. Not a heading plus one sentence.
- summary is the argument (8–12 lines) plus a confidence (high/med/low) and what evidence is thin.
- contradictions: where sources disagree, naming both ids. openQuestions: what the sources do not settle and the next measurement to take.
- Never invent numbers, quotes, cases, or sources. If a fact is not in the passages, say "not in sources".
- No campus / student / course nouns unless the question itself requires them.`;

export const CITE_REPAIR_SYSTEM = `You repair research findings so every citation points at a source that still has a verbatim passage. Return ONLY JSON:
{"findings": [{ "heading": string, "body": string, "sources": string[] }]}
Rules:
- Use only the passage-backed sources in the prompt. Every [S#] in a body must be one of those ids, and the same ids go in sources.
- Do not cite a source that is missing, unreachable, or listed with no passage. Do not invent passages, numbers, or sources.
- Drop a finding you cannot support from those passages. If none of the draft can be supported, return {"findings": []}.
- At most 8 findings. Keep a finding that already cites only passage-backed sources.`;

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(extractJsonObject(raw));
  } catch {
    throw new ApiError("invalid_research", `Model returned invalid JSON for the ${what}`, 502);
  }
}

function cleanList(values: unknown, cap: number): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    const key = text.toLowerCase();
    if (text && !seen.has(key) && out.length < cap) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** Sub-queries from the planner; the question itself always leads so a bad plan still searches. */
export function parsePlan(raw: string, question: string, maxQueries = RESEARCH_CAPS.maxQueries): string[] {
  let planned: string[] = [];
  try {
    const parsed = parseJson(raw, "research plan") as { queries?: unknown };
    planned = cleanList(parsed.queries, maxQueries);
  } catch {
    planned = [];
  }
  return cleanList([question, ...planned], maxQueries);
}

export function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export type Candidate = { id: string; title: string; url: string; snippet: string; foundBy: string };

/** Round-robin across queries so each contributes, dedupe by URL, HTTPS only, cap the total. */
export function dedupeCandidates(perQuery: Array<{ query: string; hits: SearchHit[] }>, maxPages: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const longest = Math.max(0, ...perQuery.map((entry) => entry.hits.length));
  for (let index = 0; index < longest; index += 1) {
    for (const entry of perQuery) {
      const hit = entry.hits[index];
      const url = hit?.url?.trim() ?? "";
      if (!hit || !url.startsWith("https://") || out.length >= maxPages) {
        continue;
      }
      const key = normalizeUrlKey(url);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        id: `S${out.length + 1}`,
        title: (hit.title ?? "").trim(),
        url,
        snippet: (hit.description ?? "").trim(),
        foundBy: entry.query,
      });
    }
  }
  return out;
}

/** Whitespace, case, and typography (curly quotes, dashes, ellipsis) do not count as edits. */
function squash(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Keep only passages that really occur in the page (verbatim, whitespace-insensitive). */
export function parseExtraction(raw: string, pageText: string, cap = RESEARCH_CAPS.maxPassagesPerSource) {
  const parsed = parseJson(raw, "source extraction") as { passages?: unknown; notes?: unknown };
  const haystack = squash(pageText);
  const passages = cleanList(parsed.passages, cap * 2)
    .filter((passage) => passage.length >= PASSAGE_MIN && haystack.includes(squash(passage)))
    .slice(0, cap);
  const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
  return { passages, notes };
}

export type Synthesis = {
  title: string;
  summary: string;
  findings: DossierFinding[];
  contradictions: string[];
  openQuestions: string[];
};

export function parseSynthesis(raw: string, sourceIds: readonly string[]): Synthesis {
  const parsed = parseJson(raw, "research findings") as Record<string, unknown>;
  const known = new Set(sourceIds);
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .map((item): DossierFinding | null => {
      const record = (item ?? {}) as { heading?: unknown; body?: unknown; sources?: unknown };
      const heading = typeof record.heading === "string" ? record.heading.trim() : "";
      const body = typeof record.body === "string" ? record.body.trim() : "";
      if (!heading || !body) {
        return null;
      }
      const listed = cleanList(record.sources, 20).map((id) => id.toUpperCase());
      const cited = citedSourceIds(body);
      const sources = [...new Set([...listed, ...cited])].filter((id) => known.has(id));
      return { heading, body, sources };
    })
    .filter((item): item is DossierFinding => item !== null);
  if (findings.length === 0) {
    throw new ApiError("invalid_research", "Model returned no findings", 502);
  }
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Research dossier";
  const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "";
  return {
    title,
    summary,
    findings,
    contradictions: cleanList(parsed.contradictions, 20),
    openQuestions: cleanList(parsed.openQuestions, 20),
  };
}

/** A source backs a citation only when the page was read and a verbatim passage was kept. */
export function passageBackedIds(
  sources: readonly { id: string; status: string; passages: readonly string[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (source.status !== "read") {
      continue;
    }
    if (source.passages.some((passage) => passage.trim().length >= PASSAGE_MIN)) {
      ids.add(source.id);
    }
  }
  return ids;
}

/** True when every listed and in-body id names a passage-backed source, and there is at least one. */
export function findingCitesResolve(finding: DossierFinding, backed: ReadonlySet<string>): boolean {
  const ids = [...new Set([...finding.sources, ...citedSourceIds(finding.body)])];
  return ids.length > 0 && ids.every((id) => backed.has(id));
}

/** Drop `[S#]` tokens that do not name a passage-backed source. Other words stay. */
export function stripUnresolvedCites(text: string, backed: ReadonlySet<string>): string {
  return text
    .replace(/\[(S\d+)\]/g, (match, id: string) => (backed.has(id) ? match : ""))
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Keep findings whose cites all name a kept passage. A finding that loses every cite is omitted;
 * the caller records that heading as an open question.
 */
export function groundFindings(findings: readonly DossierFinding[], backed: ReadonlySet<string>): DossierFinding[] {
  const kept: DossierFinding[] = [];
  for (const finding of findings) {
    const body = stripUnresolvedCites(finding.body, backed);
    const sources = [...new Set([...finding.sources, ...citedSourceIds(body)])].filter((id) => backed.has(id));
    if (!finding.heading.trim() || !body || sources.length === 0) {
      continue;
    }
    kept.push({ heading: finding.heading.trim(), body, sources });
  }
  return kept;
}

/** Repair JSON. `null` means the model did not return findings we can read; an empty list is a real answer. */
export function parseRepairFindings(raw: string): DossierFinding[] | null {
  try {
    const parsed = parseJson(raw, "citation repair") as { findings?: unknown };
    return (Array.isArray(parsed.findings) ? parsed.findings : [])
      .map((item): DossierFinding | null => {
        const record = (item ?? {}) as { heading?: unknown; body?: unknown; sources?: unknown };
        const heading = typeof record.heading === "string" ? record.heading.trim() : "";
        const body = typeof record.body === "string" ? record.body.trim() : "";
        if (!heading || !body) {
          return null;
        }
        const sources = cleanList(record.sources, 20)
          .map((id) => id.toUpperCase())
          .filter((id) => /^S\d+$/.test(id));
        return { heading, body, sources };
      })
      .filter((item): item is DossierFinding => item !== null);
  } catch {
    return null;
  }
}

function researchHostCopy(locale: AppLocale | undefined) {
  return RESEARCH_HOST_COPY[parseAppLocale(locale ?? "en")];
}

function repairPrompt(
  question: string,
  sources: readonly DossierSource[],
  backed: ReadonlySet<string>,
  findings: readonly DossierFinding[],
): string {
  const blocks = sources
    .filter((source) => backed.has(source.id))
    .map((source) => sourcePromptBlock(source))
    .join("\n\n");
  const draft = findings.map((finding) => `- ${finding.heading}: ${finding.body}`).join("\n");
  return `Question:\n${question}\n\nPassage-backed sources:\n${blocks}\n\nDraft findings to repair:\n${draft}`;
}

/** The existing notes shape, derived deterministically so every citation resolves to a real source. */
export function notesFromDossier(dossier: Dossier, summary: string): ResearchNotes {
  const byId = new Map(dossier.sources.map((source) => [source.id, source]));
  return {
    title: dossier.title,
    summary: summary || `Findings from ${dossier.sources.length} sources.`,
    notes: dossier.findings.map((finding) => ({
      heading: finding.heading,
      body: finding.body,
      sources: finding.sources
        .map((id) => byId.get(id))
        .filter((source): source is DossierSource => Boolean(source))
        .map((source) => ({ title: `${source.id} ${source.title}`.trim(), url: source.url })),
    })),
  };
}

function sourcePromptBlock(source: DossierSource): string {
  const passages = source.passages.map((passage) => `  > ${passage}`).join("\n");
  return [
    `${source.id} — ${source.title || source.url}`,
    `  URL: ${source.url}`,
    `  Status: ${source.status}${source.notes ? ` — ${source.notes}` : ""}`,
    passages || "  (no passages)",
  ].join("\n");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readSource(
  candidate: Candidate,
  question: string,
  deps: DossierDeps,
  retrievedAt: string,
  pageChars: number,
) {
  const base = {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    retrievedAt,
    foundBy: candidate.foundBy,
  };
  const emit = deps.emit ?? (() => {});
  try {
    const page = await deps.readPage(candidate.url);
    const raw = await deps.ask(
      EXTRACT_SYSTEM,
      `Question:\n${question}\n\nPage title: ${page.title || candidate.title}\nPage text:\n${page.text.slice(0, pageChars)}`,
    );
    const { passages, notes } = parseExtraction(raw, page.text);
    emit({
      type: "job.source",
      id: candidate.id,
      title: page.title || candidate.title,
      url: candidate.url,
      status: "read",
    });
    return { ...base, title: page.title || candidate.title, status: "read" as const, passages, notes };
  } catch (error) {
    if (error instanceof ApiError && error.code === "aborted") {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "unreachable";
    emit({ type: "job.source", id: candidate.id, title: candidate.title, url: candidate.url, status: "unreachable" });
    return {
      ...base,
      status: "unreachable" as const,
      passages: candidate.snippet ? [candidate.snippet] : [],
      notes: `Could not read page: ${reason}. Search snippet kept above.`,
    };
  }
}

/** Plan → search → read → extract → synthesize. Pure over `deps`; nothing here touches settings or the DB. */
export async function runResearchDossier(input: DossierRunInput, deps: DossierDeps): Promise<DossierRunResult> {
  const caps = { ...RESEARCH_CAPS, ...deps.caps };
  const emit = deps.emit ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const question = input.question.trim();

  throwIfJobAborted(deps.abortSignal);
  emit({ type: "job.phase", phase: "planning", label: "Planning sub-queries" });
  let planRaw = "";
  try {
    planRaw = await deps.ask(PLAN_SYSTEM, `Question:\n${question}`);
  } catch {
    planRaw = "";
  }
  const queries = parsePlan(planRaw, question, caps.maxQueries);

  throwIfJobAborted(deps.abortSignal);
  emit({ type: "job.phase", phase: "searching", label: "Searching the web" });
  const perQuery: Array<{ query: string; hits: SearchHit[] }> = [];
  for (const [index, query] of queries.entries()) {
    throwIfJobAborted(deps.abortSignal);
    emit({ type: "job.step", phase: "searching", label: query, current: index + 1, total: queries.length });
    perQuery.push({ query, hits: (await deps.search(query)).slice(0, caps.hitsPerQuery) });
  }
  const candidates = dedupeCandidates(perQuery, caps.maxPages);
  if (candidates.length === 0) {
    throw new ApiError("tool_failed", "Search returned no readable HTTPS results for this question", 502);
  }
  for (const candidate of candidates) {
    emit({ type: "job.source", id: candidate.id, title: candidate.title, url: candidate.url, status: "found" });
  }

  throwIfJobAborted(deps.abortSignal);
  emit({ type: "job.phase", phase: "reading", label: "Reading pages" });
  const retrievedAt = now().toISOString();
  let done = 0;
  const sources = await mapWithConcurrency(candidates, caps.readConcurrency, async (candidate) => {
    throwIfJobAborted(deps.abortSignal);
    const source = await readSource(candidate, question, deps, retrievedAt, caps.pageChars);
    done += 1;
    emit({
      type: "job.step",
      phase: "reading",
      label: source.title || source.url,
      current: done,
      total: candidates.length,
    });
    return source;
  });

  throwIfJobAborted(deps.abortSignal);
  const copy = researchHostCopy(deps.locale);
  const backed = passageBackedIds(sources);
  if (backed.size === 0) {
    throw new ApiError("invalid_research", copy.noPassage, 502);
  }

  emit({ type: "job.phase", phase: "drafting", label: "Drafting findings" });
  const synthesisPrompt = `Question:\n${question}\n\nSources:\n${sources.map(sourcePromptBlock).join("\n\n")}`;
  let synthesis = parseSynthesis(
    await deps.ask(SYNTHESIS_SYSTEM, synthesisPrompt),
    sources.map((source) => source.id),
  );

  if (!synthesis.findings.every((finding) => findingCitesResolve(finding, backed))) {
    throwIfJobAborted(deps.abortSignal);
    emit({ type: "job.phase", phase: "checking", label: copy.checking });
    try {
      const repaired = parseRepairFindings(
        await deps.ask(CITE_REPAIR_SYSTEM, repairPrompt(question, sources, backed, synthesis.findings)),
      );
      if (repaired && repaired.length > 0) {
        synthesis = { ...synthesis, findings: repaired };
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "aborted") {
        throw error;
      }
    }
  }

  const findings = groundFindings(synthesis.findings, backed);
  if (findings.length === 0) {
    throw new ApiError("invalid_research", "Model returned no findings", 502);
  }
  const dropped = synthesis.findings.filter((finding) => !findings.some((kept) => kept.heading === finding.heading));

  const dossier = dossierSchema.parse({
    title: synthesis.title,
    question,
    created: retrievedAt,
    models: input.models,
    queries,
    sources,
    findings,
    contradictions: cleanList(
      synthesis.contradictions.map((item) => stripUnresolvedCites(item, backed)).filter((item) => item.length > 0),
      20,
    ),
    openQuestions: cleanList(
      [...synthesis.openQuestions, ...dropped.map((finding) => copy.citeGap(finding.heading))],
      20,
    ),
  });
  return { dossier, notes: notesFromDossier(dossier, synthesis.summary) };
}
