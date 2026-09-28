import { ApiError, parseAppLocale, type AppLocale } from "@agentforge/core";
import {
  citedSourceIds,
  dossierSchema,
  type ComparisonRow,
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

/** A claim shorter than that floor is not searched. */
const CLAIM_MIN = PASSAGE_MIN;

/**
 * Host copy for the citation check and the comparison phase. Mirrors `phaseChecking`,
 * `phaseComparing`, `errorNoPassage`, and `citeGap` in `apps/web/locales/{en,id}/research.json`.
 * The host does not import those catalogs. Verdict phrases live with the dossier Markdown.
 */
const RESEARCH_HOST_COPY: Record<
  AppLocale,
  { checking: string; comparing: string; noPassage: string; citeGap: (heading: string) => string }
> = {
  en: {
    checking: "Checking citations",
    comparing: "Comparing sources",
    noPassage: "No page kept a sentence that can be cited.",
    citeGap: (heading) => `Could not cite a kept passage: ${heading}`,
  },
  id: {
    checking: "Memeriksa kutipan",
    comparing: "Membandingkan sumber",
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

export const CLAIMS_SYSTEM = `You pull claims from the question and any pasted text. Return ONLY JSON: {"claims": string[]}.
Rules:
- Copy each claim from the user's words. Take sentences they asserted, and sentences they asked you to check, from the question and from text they pasted.
- Do not add a claim they did not write. Do not paraphrase. Do not add a source.
- At most 5 claims. Same language as the user.`;

export const EXTRACT_SYSTEM = `You extract evidence from one web page for a research dossier. Return ONLY JSON:
{"passages": string[], "notes": string, "onClaims": [{ "claim": string, "passage": string, "stance": "supports" | "contradicts" }]}
Rules:
- passages: up to 5 sentences copied VERBATIM from the page text that bear on the question. Do not paraphrase, do not merge sentences, do not add words.
- notes: one or two lines on why this source matters and how much to trust it (who published it, date if visible, marketing vs. data).
- onClaims: for each claim in the prompt this page addresses, one object. passage is copied VERBATIM from the page and is one of passages. claim is copied from the Claims list. stance is "supports" when the passage affirms the claim and "contradicts" when the passage denies it. Omit a claim the page does not address. If there is no Claims list, return "onClaims": [].
- If the page says nothing relevant, return {"passages": [], "notes": "Not relevant: <why>", "onClaims": []}.`;

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
- summary is the reading (8–12 lines) plus a confidence (high/med/low) and what evidence is thin. The comparison rows are already decided: do not add a row and do not change a verdict.
- contradictions: where sources disagree, naming both ids. openQuestions: what the sources do not settle and the next measurement to take.
- Never invent numbers, quotes, cases, or sources. A quotation must be copied from a passage above. If a fact is not in the passages, say "not in sources".
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

export type ClaimStance = "supports" | "contradicts";

export type ClaimHit = {
  claim: string;
  sourceId: string;
  passage: string;
  stance: ClaimStance;
};

/** Claims the model copied out of the question or the pasted text. Anything else is dropped. */
export function parseClaims(raw: string, sourceText: string, cap = RESEARCH_CAPS.maxQueries): string[] {
  let listed: string[] = [];
  try {
    const parsed = parseJson(raw, "research claims") as { claims?: unknown };
    listed = cleanList(parsed.claims, cap * 2);
  } catch {
    listed = [];
  }
  const haystack = squash(sourceText);
  return cleanList(
    listed.filter((claim) => claim.length >= CLAIM_MIN && haystack.includes(squash(claim))),
    cap,
  );
}

/** Sentences already in the prompt, when the model returned nothing that is actually there. */
export function fallbackClaims(sourceText: string, cap = RESEARCH_CAPS.maxQueries): string[] {
  const parts = sourceText
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part.length >= CLAIM_MIN);
  return cleanList(parts, cap);
}

export function claimsForRun(raw: string, sourceText: string, cap = RESEARCH_CAPS.maxQueries): string[] {
  const pulled = parseClaims(raw, sourceText, cap);
  return pulled.length > 0 ? pulled : fallbackClaims(sourceText, cap);
}

/** Each claim is searched. Planner queries fill whatever room the cap still has. */
export function researchQueries(
  claims: readonly string[],
  planned: readonly string[],
  question: string,
  max = RESEARCH_CAPS.maxQueries,
): string[] {
  const lead = claims.length > 0 ? [...claims] : [question];
  return cleanList([...lead, ...planned], max);
}

function canonicalClaim(claim: string, claims: readonly string[]): string | null {
  const needle = squash(claim);
  return claims.find((item) => squash(item) === needle) ?? null;
}

/** Model stance labels whose passage is not on the page are dropped. */
export function parseClaimPassages(
  raw: string,
  pageText: string,
  claims: readonly string[],
  cap = RESEARCH_CAPS.maxPassagesPerSource,
): Array<{ claim: string; passage: string; stance: ClaimStance }> {
  let parsed: { onClaims?: unknown };
  try {
    parsed = parseJson(raw, "source extraction") as { onClaims?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.onClaims)) {
    return [];
  }
  const haystack = squash(pageText);
  const out: Array<{ claim: string; passage: string; stance: ClaimStance }> = [];
  for (const item of parsed.onClaims) {
    if (out.length >= cap) {
      break;
    }
    const record = (item ?? {}) as { claim?: unknown; passage?: unknown; stance?: unknown };
    const passage = typeof record.passage === "string" ? record.passage.trim().replace(/\s+/g, " ") : "";
    const claim = typeof record.claim === "string" ? canonicalClaim(record.claim, claims) : null;
    const stance = record.stance === "supports" || record.stance === "contradicts" ? record.stance : null;
    if (!claim || !stance || passage.length < PASSAGE_MIN || !haystack.includes(squash(passage))) {
      continue;
    }
    out.push({ claim, passage, stance });
  }
  return out;
}

/** A kept passage that contains the claim is that source saying it. No model label required. */
export function literalSupports(claims: readonly string[], sourceId: string, passages: readonly string[]): ClaimHit[] {
  const hits: ClaimHit[] = [];
  for (const claim of claims) {
    const needle = squash(claim);
    if (needle.length < CLAIM_MIN) {
      continue;
    }
    const passage = passages.find((item) => squash(item).includes(needle));
    if (passage) {
      hits.push({ claim, sourceId, passage, stance: "supports" });
    }
  }
  return hits;
}

function sourceRank(id: string): number {
  const rank = Number(id.slice(1));
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

/**
 * One row per claim that still has a kept passage. The verdict is a count of source stances:
 * one source, every source the same stance, or a split. A claim with no hit is omitted.
 */
export function buildComparison(claims: readonly string[], hits: readonly ClaimHit[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const claim of claims) {
    const needle = squash(claim);
    const matched = hits.filter((hit) => squash(hit.claim) === needle);
    const bySource = new Map<string, Set<ClaimStance>>();
    for (const hit of matched) {
      const stances = bySource.get(hit.sourceId) ?? new Set<ClaimStance>();
      stances.add(hit.stance);
      bySource.set(hit.sourceId, stances);
    }
    const sources = [...bySource.keys()].sort((left, right) => sourceRank(left) - sourceRank(right));
    if (sources.length === 0) {
      continue;
    }
    let verdict: ComparisonRow["verdict"] = "only";
    if (sources.length > 1) {
      const stances = new Set<ClaimStance>();
      let mixed = false;
      for (const id of sources) {
        const local = bySource.get(id);
        if (local?.size !== 1) {
          mixed = true;
          continue;
        }
        for (const stance of local) {
          stances.add(stance);
        }
      }
      verdict = !mixed && stances.size === 1 ? "agree" : "contradict";
    }
    rows.push({ claim, verdict, sources });
  }
  return rows;
}

/** Drop a quotation that is not a span of a kept passage. The surrounding words stay. */
export function stripInventedQuotes(text: string, passages: readonly string[]): string {
  const haystacks = passages.map((passage) => squash(passage)).filter((passage) => passage.length > 0);
  return text
    .replace(/["“]([^"”]+)["”]/g, (match, inner: string) => {
      const needle = squash(inner);
      if (!needle) {
        return match;
      }
      return haystacks.some((hay) => hay.includes(needle)) ? match : "";
    })
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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

function comparisonPromptBlock(rows: readonly ComparisonRow[]): string {
  if (rows.length === 0) {
    return "(no claim kept a passage)";
  }
  return rows.map((row) => `- ${row.claim} — ${row.verdict} ${row.sources.map((id) => `[${id}]`).join("")}`).join("\n");
}

function quoteablePassages(sources: readonly DossierSource[], backed: ReadonlySet<string>): string[] {
  return sources.filter((source) => backed.has(source.id)).flatMap((source) => source.passages);
}

function stripFindingQuotes<T extends { body: string }>(findings: readonly T[], passages: readonly string[]): T[] {
  return findings.map((finding) => ({ ...finding, body: stripInventedQuotes(finding.body, passages) }));
}

async function readSource(
  candidate: Candidate,
  question: string,
  claims: readonly string[],
  deps: DossierDeps,
  retrievedAt: string,
  pageChars: number,
): Promise<{ source: DossierSource; hits: ClaimHit[] }> {
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
    const claimList = claims.length > 0 ? claims.map((claim) => `- ${claim}`).join("\n") : "(none)";
    const raw = await deps.ask(
      EXTRACT_SYSTEM,
      `Question:\n${question}\n\nClaims:\n${claimList}\n\nPage title: ${page.title || candidate.title}\nPage text:\n${page.text.slice(0, pageChars)}`,
    );
    const { passages, notes } = parseExtraction(raw, page.text);
    const hits = [
      ...literalSupports(claims, candidate.id, passages),
      ...parseClaimPassages(raw, page.text, claims).map((hit) => ({ ...hit, sourceId: candidate.id })),
    ];
    emit({
      type: "job.source",
      id: candidate.id,
      title: page.title || candidate.title,
      url: candidate.url,
      status: "read",
    });
    return {
      source: { ...base, title: page.title || candidate.title, status: "read" as const, passages, notes },
      hits,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "aborted") {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "unreachable";
    emit({ type: "job.source", id: candidate.id, title: candidate.title, url: candidate.url, status: "unreachable" });
    return {
      source: {
        ...base,
        status: "unreachable" as const,
        passages: candidate.snippet ? [candidate.snippet] : [],
        notes: `Could not read page: ${reason}. Search snippet kept above.`,
      },
      hits: [],
    };
  }
}

/** Pull claims → search each one → read → keep on-page passages → compare in code → the model writes the reading. */
export async function runResearchDossier(input: DossierRunInput, deps: DossierDeps): Promise<DossierRunResult> {
  const caps = { ...RESEARCH_CAPS, ...deps.caps };
  const emit = deps.emit ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const question = input.question.trim();

  throwIfJobAborted(deps.abortSignal);
  emit({ type: "job.phase", phase: "planning", label: "Planning sub-queries" });
  let claimsRaw = "";
  try {
    claimsRaw = await deps.ask(CLAIMS_SYSTEM, `Question and pasted text:\n${question}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "aborted") {
      throw error;
    }
    claimsRaw = "";
  }
  let planRaw = "";
  try {
    planRaw = await deps.ask(PLAN_SYSTEM, `Question:\n${question}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "aborted") {
      throw error;
    }
    planRaw = "";
  }
  const claims = claimsForRun(claimsRaw, question, caps.maxQueries);
  const queries = researchQueries(claims, parsePlan(planRaw, question, caps.maxQueries), question, caps.maxQueries);

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
  const read = await mapWithConcurrency(candidates, caps.readConcurrency, async (candidate) => {
    throwIfJobAborted(deps.abortSignal);
    const result = await readSource(candidate, question, claims, deps, retrievedAt, caps.pageChars);
    done += 1;
    emit({
      type: "job.step",
      phase: "reading",
      label: result.source.title || result.source.url,
      current: done,
      total: candidates.length,
    });
    return result;
  });
  const sources = read.map((result) => result.source);
  const hits = read.flatMap((result) => result.hits);

  throwIfJobAborted(deps.abortSignal);
  const copy = researchHostCopy(deps.locale);
  const backed = passageBackedIds(sources);
  if (backed.size === 0) {
    throw new ApiError("invalid_research", copy.noPassage, 502);
  }

  throwIfJobAborted(deps.abortSignal);
  emit({ type: "job.phase", phase: "comparing", label: copy.comparing });
  const comparison = buildComparison(
    claims,
    hits.filter((hit) => backed.has(hit.sourceId)),
  );
  const passages = quoteablePassages(sources, backed);

  emit({ type: "job.phase", phase: "drafting", label: "Drafting findings" });
  const synthesisPrompt = [
    `Question:\n${question}`,
    `Comparison (already decided in code; do not change a verdict or add a row):\n${comparisonPromptBlock(comparison)}`,
    `Sources:\n${sources.map(sourcePromptBlock).join("\n\n")}`,
  ].join("\n\n");
  let synthesis = parseSynthesis(
    await deps.ask(SYNTHESIS_SYSTEM, synthesisPrompt),
    sources.map((source) => source.id),
  );
  synthesis = {
    ...synthesis,
    summary: stripInventedQuotes(synthesis.summary, passages),
    findings: stripFindingQuotes(synthesis.findings, passages),
    contradictions: synthesis.contradictions.map((item) => stripInventedQuotes(item, passages)),
  };

  if (!synthesis.findings.every((finding) => findingCitesResolve(finding, backed))) {
    throwIfJobAborted(deps.abortSignal);
    emit({ type: "job.phase", phase: "checking", label: copy.checking });
    try {
      const repaired = parseRepairFindings(
        await deps.ask(CITE_REPAIR_SYSTEM, repairPrompt(question, sources, backed, synthesis.findings)),
      );
      if (repaired && repaired.length > 0) {
        synthesis = { ...synthesis, findings: stripFindingQuotes(repaired, passages) };
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
    comparison,
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
