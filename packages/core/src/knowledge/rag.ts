import { parseAppLocale, type AppLocale } from "../locale";

export type KnowledgeMapTopic = {
  title: string;
  summary: string;
  sourceIds: string[];
  verdict: "supported" | "weak" | "unsupported" | "stub";
  note: string;
};

export type KnowledgeMap = {
  overview: string;
  topics: KnowledgeMapTopic[];
  gaps: string[];
  ready: boolean;
  source: "stub" | "live";
  embeddingModel: string;
  brainModel: string;
  verifierModel: string;
  createdAt: number;
};

export type KnowledgeModels = {
  embeddingModel: string;
  brainModel: string;
  verifierModel: string;
};

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    na += left * left;
    nb += right * right;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function stubEmbed(text: string, dims = 32): number[] {
  const vec = Array.from({ length: dims }, () => 0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const word of words) {
    let hash = 2166136261;
    for (let i = 0; i < word.length; i += 1) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

export function parseEmbeddingResponse(payload: unknown): number[][] {
  const record = payload && typeof payload === "object" ? (payload as { data?: unknown }) : {};
  if (!Array.isArray(record.data)) {
    return [];
  }
  return record.data
    .map((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const embedding = (item as { embedding?: unknown }).embedding;
      return Array.isArray(embedding)
        ? embedding.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        : [];
    })
    .filter((row) => row.length > 0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asVerdict(value: unknown): KnowledgeMapTopic["verdict"] {
  return value === "supported" || value === "weak" || value === "unsupported" || value === "stub" ? value : "weak";
}

export function parseKnowledgeMap(raw: string, models: KnowledgeModels, source: "stub" | "live"): KnowledgeMap | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const topicsRaw = Array.isArray(record.topics) ? record.topics : [];
  const topics = topicsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      summary: typeof item.summary === "string" ? item.summary.trim() : "",
      sourceIds: asStringArray(item.sourceIds),
      verdict: asVerdict(item.verdict),
      note: typeof item.note === "string" ? item.note.trim() : "",
    }))
    .filter((item) => item.title);
  return {
    overview: typeof record.overview === "string" ? record.overview.trim() : "",
    topics,
    gaps: asStringArray(record.gaps),
    ready: record.ready === true || topics.some((topic) => topic.verdict === "supported"),
    source,
    embeddingModel: models.embeddingModel,
    brainModel: models.brainModel,
    verifierModel: models.verifierModel,
    createdAt: Date.now(),
  };
}

export function stubKnowledgeMap(
  sources: Array<{ id: string; name: string }>,
  models: KnowledgeModels,
  locale: AppLocale = "en",
): KnowledgeMap {
  const id = parseAppLocale(locale) === "id";
  return {
    overview: sources.length
      ? id
        ? `Peta stub dari ${sources.length} sumber. Pemetaan live memakai brain dan verifier yang Anda pilih.`
        : `Stub map of ${sources.length} source${sources.length === 1 ? "" : "s"}. Live mapping uses the brain and verifier you pick.`
      : id
        ? "Belum ada sumber untuk dipetakan. Tambah catatan, berkas, atau URL dulu."
        : "No sources to map yet. Add a note, file, or URL first.",
    topics: sources.slice(0, 8).map((source) => ({
      title: source.name,
      summary: id ? "Terindeks dan siap diambil." : "Indexed and ready for retrieve.",
      sourceIds: [source.id],
      verdict: "stub",
      note: id
        ? "Verifier stub: vektor leksikal plus hash sudah ada."
        : "Stub verifier: lexical plus hash vectors are present.",
    })),
    gaps: sources.length ? [] : [id ? "Tambah sumber, lalu peta lagi." : "Add a source, then map again."],
    ready: sources.length > 0,
    source: "stub",
    embeddingModel: models.embeddingModel,
    brainModel: models.brainModel,
    verifierModel: models.verifierModel,
    createdAt: Date.now(),
  };
}

export function knowledgeBrainPrompt(sources: Array<{ id: string; name: string; excerpt: string }>): string {
  const catalog = sources
    .map((source) => `- ${source.id} · ${source.name}\n${source.excerpt.slice(0, 400)}`)
    .join("\n\n");
  return `Map this workspace knowledge base. Return JSON only, no markdown.

Schema:
{"overview":"string","topics":[{"title":"string","summary":"string","sourceIds":["source-id"]}],"gaps":["string"]}

Rules:
- Use only the sources below. Do not invent facts.
- Group related chunks into topics.
- sourceIds must be ids from the list.
- gaps are missing coverage, not style notes.

Sources:
${catalog || "(none)"}`;
}

export function knowledgeVerifierPrompt(mapJson: string, evidence: string): string {
  return `Verify this knowledge map against retrieved evidence. Return JSON only.

Schema:
{"overview":"string","topics":[{"title":"string","summary":"string","sourceIds":["id"],"verdict":"supported"|"weak"|"unsupported","note":"string"}],"gaps":["string"],"ready":true}

Rules:
- supported = evidence states the claim.
- weak = related but incomplete.
- unsupported = invented or contradicted.
- Keep titles. Do not add new facts.

Map:
${mapJson}

Evidence:
${evidence || "(none)"}`;
}
