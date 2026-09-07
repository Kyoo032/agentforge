import { ApiError } from "@agentforge/core";
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
    .filter((passage) => passage.length >= 20 && haystack.includes(squash(passage)))
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
  emit({ type: "job.phase", phase: "drafting", label: "Drafting findings" });
  const synthesisPrompt = `Question:\n${question}\n\nSources:\n${sources.map(sourcePromptBlock).join("\n\n")}`;
  const synthesis = parseSynthesis(
    await deps.ask(SYNTHESIS_SYSTEM, synthesisPrompt),
    sources.map((source) => source.id),
  );

  const dossier = dossierSchema.parse({
    title: synthesis.title,
    question,
    created: retrievedAt,
    models: input.models,
    queries,
    sources,
    findings: synthesis.findings,
    contradictions: synthesis.contradictions,
    openQuestions: synthesis.openQuestions,
  });
  return { dossier, notes: notesFromDossier(dossier, synthesis.summary) };
}
