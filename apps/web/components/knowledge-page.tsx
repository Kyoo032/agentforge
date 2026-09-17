"use client";

import { useEffect, useState } from "react";
import { FormattedText } from "@/components/formatted-text";
import { KnowledgeGraphPanel } from "@/components/knowledge-graph-panel";
import { KnowledgeLoop } from "@/components/knowledge-loop";
import { ModelSelect } from "@/components/model-select";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { apiFetch } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";
import { useWorkspaceScope } from "@/lib/workspace-scope";

type KnowledgeTab = "sources" | "soul" | "memory" | "map";

type SourceRow = {
  id: string;
  name: string;
  type: string;
  chunks: number;
  status: "Indexed" | "Indexing" | "Failed";
  error?: string | null;
};

type Memory = { id: string; text: string; pinned: boolean };

type GraphCounts = { nodes: number; edges: number };

type VerifiedCheck = { ok: boolean; at: number; detail: string };

type PickerModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  friendlyLabel?: string;
  bestFor?: string;
  tier?: "everyday" | "advanced";
};

type KnowledgeModels = {
  embeddingModel: string;
  brainModel: string;
  verifierModel: string;
};

type KnowledgeMapTopic = {
  title: string;
  summary: string;
  sourceIds: string[];
  verdict: "supported" | "weak" | "unsupported" | "stub";
  note: string;
};

type KnowledgeMap = {
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

function asModels(value: unknown): PickerModel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is PickerModel => {
    return Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
  });
}

function asString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** `graph` is absent on hosts older than this build; the loop chart then reads 0. */
function asGraphCounts(value: unknown): GraphCounts | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as { nodes?: unknown; edges?: unknown };
  return { nodes: asCount(row.nodes), edges: asCount(row.edges) };
}

/** `verified` is absent (or null) until a self-check has run; the loop chart then reads "never". */
function asVerified(value: unknown): VerifiedCheck | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as { ok?: unknown; at?: unknown; detail?: unknown };
  if (typeof row.ok !== "boolean") {
    return null;
  }
  return { ok: row.ok, at: asCount(row.at), detail: asString(row.detail) };
}

function seedModel(models: PickerModel[], preferred: string, fallback: string): string {
  const ids = new Set(models.map((model) => model.id));
  if (preferred && ids.has(preferred)) {
    return preferred;
  }
  if (fallback && ids.has(fallback)) {
    return fallback;
  }
  return models[0]?.id ?? "";
}

function verdictTagClass(verdict: KnowledgeMapTopic["verdict"]): string {
  if (verdict === "supported") {
    return "tag tag-accent";
  }
  if (verdict === "weak") {
    return "tag tag-outline";
  }
  if (verdict === "unsupported") {
    return "tag tag-neutral";
  }
  return "tag tag-outline";
}

export function KnowledgePage() {
  const { id: workspaceId, name: workspaceName } = useWorkspaceScope();
  const { productName } = useProductBrand();
  const [tab, setTab] = useState<KnowledgeTab>("sources");
  const [sources, setSources] = useState<SourceRow[]>([]);
  // Placeholder only, until GET /api/v1/knowledge lands the desk's real Soul. It follows the brand
  // (DPSBuddy, or the flavor name the packaged shell preloaded) — never a persona the host has no
  // row for.
  const [soul, setSoul] = useState({ name: productName, role: "", voice: "", rules: [] as string[] });
  const [memories, setMemories] = useState<Memory[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [pasteDraft, setPasteDraft] = useState("");
  const [ruleDraft, setRuleDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chatModels, setChatModels] = useState<PickerModel[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<PickerModel[]>([]);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [brainModel, setBrainModel] = useState("");
  const [verifierModel, setVerifierModel] = useState("");
  const [knowledgeMap, setKnowledgeMap] = useState<KnowledgeMap | null>(null);
  const [mapping, setMapping] = useState(false);
  const [retrievals, setRetrievals] = useState(0);
  const [graphCounts, setGraphCounts] = useState<GraphCounts | null>(null);
  const [verified, setVerified] = useState<VerifiedCheck | null>(null);

  async function reload() {
    const [knowledgeRes, modelsRes] = await Promise.all([apiFetch("/api/v1/knowledge"), apiFetch("/api/v1/models")]);
    const payload = await knowledgeRes.json().catch(() => ({}));
    const catalog = await modelsRes.json().catch(() => ({}));

    if (payload.soul) {
      setSoul(payload.soul);
    }
    setMemories(payload.memories ?? []);
    setSources(payload.sources ?? []);
    setRetrievals(asCount(payload.retrievals));
    setGraphCounts(asGraphCounts(payload.graph));
    setVerified(asVerified(payload.verified));
    if (payload.map) {
      setKnowledgeMap(payload.map as KnowledgeMap);
    }

    const modes =
      catalog && typeof catalog === "object" ? (catalog as { modes?: Record<string, unknown> }).modes : undefined;
    const defaults =
      catalog && typeof catalog === "object" ? (catalog as { defaults?: Record<string, unknown> }).defaults : undefined;
    const chatList = asModels(modes?.chat);
    const embeddingList = asModels(modes?.embedding);
    setChatModels(chatList);
    setEmbeddingModels(embeddingList);

    const saved =
      payload.models && typeof payload.models === "object" ? (payload.models as Partial<KnowledgeModels>) : {};
    setEmbeddingModel(seedModel(embeddingList, asString(saved.embeddingModel), asString(defaults?.embedding)));
    setBrainModel(seedModel(chatList, asString(saved.brainModel), asString(defaults?.knowledgeBrain)));
    setVerifierModel(seedModel(chatList, asString(saved.verifierModel), asString(defaults?.knowledgeVerifier)));
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("knowledge.errors.load"));
    });
  }, [workspaceId]);

  async function persistModels(next: KnowledgeModels) {
    setEmbeddingModel(next.embeddingModel);
    setBrainModel(next.brainModel);
    setVerifierModel(next.verifierModel);
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? t("knowledge.errors.saveModels"));
    }
  }

  async function runMap() {
    if (mapping) {
      return;
    }
    setMapping(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/knowledge/map", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? t("knowledge.errors.map"));
        return;
      }
      setKnowledgeMap(data as KnowledgeMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("knowledge.errors.map"));
    } finally {
      setMapping(false);
    }
  }

  async function addUrl() {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/sources/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? t("knowledge.errors.addUrl"));
      return;
    }
    setUrlDraft("");
    await reload();
  }

  async function addPaste() {
    const text = pasteDraft.trim();
    if (!text) {
      return;
    }
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t("knowledge.sources.pastedName"), text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? t("knowledge.errors.addNotes"));
      return;
    }
    setPasteDraft("");
    await reload();
  }

  async function saveSoul() {
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/soul", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(soul),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("knowledge.errors.saveSoul"));
      return;
    }
    await reload();
  }

  async function addMemory() {
    const text = memoryDraft.trim();
    if (!text) {
      return;
    }
    await apiFetch("/api/v1/knowledge/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, pinned: true }),
    });
    setMemoryDraft("");
    await reload();
  }

  return (
    <main className="px-6 py-8 text-[var(--text)]" data-testid="knowledge-page">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="kicker">{t("knowledge.kicker", { name: workspaceName })}</div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("knowledge.title")}</h3>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">{t("knowledge.intro", { name: workspaceName })}</p>
        </div>
        <div className="seg ml-auto" data-testid="knowledge-tabs">
          {(["sources", "soul", "memory", "map"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="seg-opt"
              data-on={tab === id ? "true" : "false"}
              data-testid={`knowledge-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {t(`knowledge.tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <section className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-testid="knowledge-models">
        <p className="panel-label">{t("knowledge.models.label")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--text-2)]">{t("knowledge.models.embedding")}</span>
            <ModelSelect
              models={embeddingModels}
              value={embeddingModel}
              onChange={(id) => void persistModels({ embeddingModel: id, brainModel, verifierModel })}
              disabled={mapping || embeddingModels.length === 0}
              testId="knowledge-model-embedding"
              className="input"
              flat
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--text-2)]">{t("knowledge.models.brain")}</span>
            <ModelSelect
              models={chatModels}
              value={brainModel}
              onChange={(id) => void persistModels({ embeddingModel, brainModel: id, verifierModel })}
              disabled={mapping || chatModels.length === 0}
              testId="knowledge-model-brain"
              className="input"
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--text-2)]">{t("knowledge.models.verifier")}</span>
            <ModelSelect
              models={chatModels}
              value={verifierModel}
              onChange={(id) => void persistModels({ embeddingModel, brainModel, verifierModel: id })}
              disabled={mapping || chatModels.length === 0}
              testId="knowledge-model-verifier"
              className="input"
            />
          </label>
        </div>
      </section>

      {tab === "sources" ? (
        <div className="flex flex-col gap-4" data-testid="knowledge-sources">
          <KnowledgeLoop
            sources={sources}
            retrievals={retrievals}
            graph={graphCounts}
            verified={verified}
            onRefresh={() =>
              reload().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : t("knowledge.errors.load"));
              })
            }
          />
          <KnowledgeGraphPanel
            key={`${workspaceId}:${graphCounts?.nodes ?? 0}:${graphCounts?.edges ?? 0}`}
            counts={graphCounts}
          />
          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="panel-label">{t("knowledge.sources.add")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="input min-w-[240px] flex-1"
                placeholder={t("knowledge.sources.urlPlaceholder")}
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                data-testid="knowledge-url"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void addUrl()}
                data-testid="knowledge-add-url"
              >
                {t("knowledge.sources.addUrl")}
              </button>
            </div>
            <textarea
              className="input mt-3"
              rows={4}
              placeholder={t("knowledge.sources.pastePlaceholder")}
              value={pasteDraft}
              onChange={(event) => setPasteDraft(event.target.value)}
              data-testid="knowledge-paste"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void addPaste()}
                data-testid="knowledge-add-paste"
              >
                {t("knowledge.sources.indexPaste")}
              </button>
              <label className="btn btn-secondary cursor-pointer">
                {t("knowledge.sources.uploadFile")}
                <input
                  className="sr-only"
                  type="file"
                  accept=".txt,.md,.csv,.json,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  data-testid="knowledge-file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) {
                      return;
                    }
                    void (async () => {
                      setError(null);
                      const form = new FormData();
                      form.set("file", file);
                      const res = await apiFetch("/api/v1/knowledge/sources", { method: "POST", body: form });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) {
                        setError(data?.error?.message ?? t("knowledge.errors.indexFile"));
                        return;
                      }
                      await reload();
                    })();
                  }}
                />
              </label>
            </div>
          </section>
          <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            {sources.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid="knowledge-source-row">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tag tag-neutral" data-testid="knowledge-source-type">
                  {labeled(`knowledge.sourceType.${row.type}`, row.type)}
                </span>
                <span className="text-xs">
                  {t(row.chunks === 1 ? "knowledge.sources.chunksOne" : "knowledge.sources.chunks", { count: row.chunks })}
                </span>
                <span
                  className={row.status === "Indexed" ? "tag tag-accent" : "tag tag-outline"}
                  title={row.status === "Failed" && row.error ? row.error : undefined}
                >
                  {labeled(`knowledge.status.${row.status}`, row.status)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() =>
                    void apiFetch(`/api/v1/knowledge/sources/${row.id}`, { method: "DELETE" }).then(() => reload())
                  }
                >
                  {t("knowledge.sources.remove")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "soul" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-soul">
          <label className="panel-label">{t("knowledge.soul.name")}</label>
          <input
            className="input"
            value={soul.name}
            onChange={(event) => setSoul({ ...soul, name: event.target.value })}
            data-testid="knowledge-soul-name"
          />
          <label className="panel-label">{t("knowledge.soul.role")}</label>
          <input
            className="input"
            value={soul.role}
            onChange={(event) => setSoul({ ...soul, role: event.target.value })}
            data-testid="knowledge-soul-role"
          />
          <label className="panel-label">{t("knowledge.soul.voice")}</label>
          <textarea
            className="input"
            rows={3}
            value={soul.voice}
            onChange={(event) => setSoul({ ...soul, voice: event.target.value })}
            data-testid="knowledge-soul-voice"
          />
          <ul className="text-sm">
            {soul.rules.map((rule, index) => (
              <li key={`${rule}-${index}`}>{rule}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={ruleDraft}
              onChange={(event) => setRuleDraft(event.target.value)}
              placeholder={t("knowledge.soul.rulePlaceholder")}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (ruleDraft.trim()) {
                  setSoul({ ...soul, rules: [...soul.rules, ruleDraft.trim()] });
                  setRuleDraft("");
                }
              }}
            >
              {t("knowledge.soul.addRule")}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary w-fit"
            onClick={() => void saveSoul()}
            data-testid="knowledge-soul-save"
          >
            {t("knowledge.soul.save")}
          </button>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-memory">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              data-testid="knowledge-memory-input"
              placeholder={t("knowledge.memory.placeholder")}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void addMemory()}
              data-testid="knowledge-memory-add"
            >
              {t("knowledge.memory.pin")}
            </button>
          </div>
          <ul>
            {memories.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 border-b border-[var(--line)] py-2"
                data-testid="knowledge-memory-row"
              >
                <span className="flex-1">{item.text}</span>
                {item.pinned ? <span className="tag tag-accent">{t("knowledge.memory.pinned")}</span> : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void apiFetch(`/api/v1/knowledge/memories/${item.id}`, { method: "DELETE" }).then(() => reload())
                  }
                >
                  {t("knowledge.memory.forget")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "map" ? (
        <div className="flex flex-col gap-4" data-testid="knowledge-map-panel">
          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="panel-label">{t("knowledge.map.label")}</p>
            <p className="mt-2 text-[13px] text-[var(--text-2)]">{t("knowledge.map.intro")}</p>
            <button
              type="button"
              className="btn btn-primary mt-3 w-fit"
              disabled={mapping}
              onClick={() => void runMap()}
              data-testid="knowledge-map-run"
            >
              {mapping ? t("knowledge.map.running") : t("knowledge.map.run")}
            </button>
          </section>
          {knowledgeMap ? (
            <section className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-testid="knowledge-map">
              <div className="flex flex-wrap items-center gap-2">
                <span className={knowledgeMap.ready ? "tag tag-accent" : "tag tag-outline"}>
                  {knowledgeMap.ready ? t("knowledge.map.ready") : t("knowledge.map.notReady")}
                </span>
                <span className="tag tag-neutral">
                  {knowledgeMap.source === "live" ? t("knowledge.map.sourceLive") : t("knowledge.map.sourceStub")}
                </span>
              </div>
              <FormattedText text={knowledgeMap.overview} className="text-[14px]" />
              <ul className="flex flex-col gap-3">
                {knowledgeMap.topics.map((topic) => (
                  <li key={`${topic.title}-${topic.verdict}`} className="border-t border-[var(--line)] pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{topic.title}</span>
                      <span className={verdictTagClass(topic.verdict)}>
                        {labeled(`knowledge.verdict.${topic.verdict}`, topic.verdict)}
                      </span>
                    </div>
                    <FormattedText
                      text={topic.summary}
                      className="mt-1 text-[13px] text-[var(--text)]"
                    />
                    {topic.note ? (
                      <FormattedText
                        text={topic.note}
                        className="mt-1 text-xs text-[var(--text-2)]"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {knowledgeMap.gaps.length > 0 ? (
                <div>
                  <p className="panel-label">{t("knowledge.map.gaps")}</p>
                  <ul className="mt-2 list-disc pl-5 text-[13px]">
                    {knowledgeMap.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
