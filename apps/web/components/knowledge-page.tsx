"use client";

import { useEffect, useState } from "react";
import { FormattedText } from "@/components/formatted-text";
import { ModelSelect } from "@/components/model-select";
import { apiFetch } from "@/lib/api-client";
import { useWorkspaceScope } from "@/lib/workspace-scope";

type KnowledgeTab = "sources" | "soul" | "memory" | "map";

type SourceRow = {
  id: string;
  name: string;
  type: string;
  chunks: number;
  status: "Indexed" | "Indexing" | "Failed";
};

type Memory = { id: string; text: string; pinned: boolean };

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
  const [tab, setTab] = useState<KnowledgeTab>("sources");
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [soul, setSoul] = useState({ name: "Forge", role: "", voice: "", rules: [] as string[] });
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

  async function reload() {
    const [knowledgeRes, modelsRes] = await Promise.all([
      apiFetch("/api/v1/knowledge"),
      apiFetch("/api/v1/models"),
    ]);
    const payload = await knowledgeRes.json().catch(() => ({}));
    const catalog = await modelsRes.json().catch(() => ({}));

    if (payload.soul) {
      setSoul(payload.soul);
    }
    setMemories(payload.memories ?? []);
    setSources(payload.sources ?? []);
    if (payload.map) {
      setKnowledgeMap(payload.map as KnowledgeMap);
    }

    const modes = catalog && typeof catalog === "object" ? (catalog as { modes?: Record<string, unknown> }).modes : undefined;
    const defaults =
      catalog && typeof catalog === "object" ? (catalog as { defaults?: Record<string, unknown> }).defaults : undefined;
    const chatList = asModels(modes?.chat);
    const embeddingList = asModels(modes?.embedding);
    setChatModels(chatList);
    setEmbeddingModels(embeddingList);

    const saved =
      payload.models && typeof payload.models === "object"
        ? (payload.models as Partial<KnowledgeModels>)
        : {};
    setEmbeddingModel(
      seedModel(embeddingList, asString(saved.embeddingModel), asString(defaults?.embedding)),
    );
    setBrainModel(
      seedModel(chatList, asString(saved.brainModel), asString(defaults?.knowledgeBrain)),
    );
    setVerifierModel(
      seedModel(chatList, asString(saved.verifierModel), asString(defaults?.knowledgeVerifier)),
    );
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load knowledge");
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
      setError(data?.error?.message ?? "Could not save knowledge models");
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
        setError(data?.error?.message ?? "Could not map knowledge");
        return;
      }
      setKnowledgeMap(data as KnowledgeMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not map knowledge");
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
      setError(data?.error?.message ?? "Could not add URL");
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
      body: JSON.stringify({ name: "Pasted notes", text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? "Could not add notes");
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
      setError(data?.error?.message ?? "Could not save soul");
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
    <main className="px-[30px] pb-10 pt-[26px] text-inkbase" data-testid="knowledge-page">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="kicker">{workspaceName} › Knowledge Base</div>
          <h3 className="mt-2 text-[25px]">Knowledge Base</h3>
          <p className="mt-1 text-[13px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            Soul, memory, and sources for the {workspaceName} desk. Other workspaces keep their own knowledge.
          </p>
        </div>
        <div className="seg ml-auto" data-testid="knowledge-tabs">
          {(["sources", "soul", "memory", "map"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="seg-opt capitalize"
              data-on={tab === id ? "true" : "false"}
              data-testid={`knowledge-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <section className="blueprint mb-4 p-[18px]" data-testid="knowledge-models">
        <p className="panel-label">Models</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">Embedding</span>
            <ModelSelect
              models={embeddingModels}
              value={embeddingModel}
              onChange={(id) =>
                void persistModels({ embeddingModel: id, brainModel, verifierModel })
              }
              disabled={mapping || embeddingModels.length === 0}
              testId="knowledge-model-embedding"
              className="input"
              flat
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">Brain</span>
            <ModelSelect
              models={chatModels}
              value={brainModel}
              onChange={(id) =>
                void persistModels({ embeddingModel, brainModel: id, verifierModel })
              }
              disabled={mapping || chatModels.length === 0}
              testId="knowledge-model-brain"
              className="input"
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">Verifier</span>
            <ModelSelect
              models={chatModels}
              value={verifierModel}
              onChange={(id) =>
                void persistModels({ embeddingModel, brainModel, verifierModel: id })
              }
              disabled={mapping || chatModels.length === 0}
              testId="knowledge-model-verifier"
              className="input"
            />
          </label>
        </div>
      </section>

      {tab === "sources" ? (
        <div className="flex flex-col gap-4" data-testid="knowledge-sources">
          <section className="blueprint p-[18px]">
            <p className="panel-label">Add a source</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className="input min-w-[240px] flex-1" placeholder="https://…" value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} data-testid="knowledge-url" />
              <button type="button" className="btn btn-primary" onClick={() => void addUrl()} data-testid="knowledge-add-url">
                Add URL
              </button>
            </div>
            <textarea className="input mt-3" rows={4} placeholder="Paste notes…" value={pasteDraft} onChange={(event) => setPasteDraft(event.target.value)} data-testid="knowledge-paste" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => void addPaste()} data-testid="knowledge-add-paste">
                Index paste
              </button>
              <label className="btn btn-secondary cursor-pointer">
                Upload file
                <input
                  className="sr-only"
                  type="file"
                  accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
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
                        setError(data?.error?.message ?? "Could not index file");
                        return;
                      }
                      await reload();
                    })();
                  }}
                />
              </label>
            </div>
          </section>
          <ul className="blueprint divide-y divide-[color-mix(in_srgb,var(--color-text)_8%,transparent)]">
            {sources.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid="knowledge-source-row">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tag tag-neutral">{row.type}</span>
                <span className="text-[12px]">{row.chunks} chunks</span>
                <span className={row.status === "Indexed" ? "tag tag-accent" : "tag tag-outline"}>{row.status}</span>
                <button
                  type="button"
                  className="btn btn-ghost text-[12px]"
                  onClick={() => void apiFetch(`/api/v1/knowledge/sources/${row.id}`, { method: "DELETE" }).then(() => reload())}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "soul" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-soul">
          <label className="panel-label">Name</label>
          <input className="input" value={soul.name} onChange={(event) => setSoul({ ...soul, name: event.target.value })} data-testid="knowledge-soul-name" />
          <label className="panel-label">Role</label>
          <input className="input" value={soul.role} onChange={(event) => setSoul({ ...soul, role: event.target.value })} data-testid="knowledge-soul-role" />
          <label className="panel-label">Voice</label>
          <textarea className="input" rows={3} value={soul.voice} onChange={(event) => setSoul({ ...soul, voice: event.target.value })} data-testid="knowledge-soul-voice" />
          <ul className="text-sm">
            {soul.rules.map((rule, index) => (
              <li key={`${rule}-${index}`}>{rule}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className="input flex-1" value={ruleDraft} onChange={(event) => setRuleDraft(event.target.value)} placeholder="Add a rule" />
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
              Add rule
            </button>
          </div>
          <button type="button" className="btn btn-primary w-fit" onClick={() => void saveSoul()} data-testid="knowledge-soul-save">
            Save soul
          </button>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-memory">
          <div className="flex gap-2">
            <input className="input flex-1" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} data-testid="knowledge-memory-input" placeholder="Pin a memory" />
            <button type="button" className="btn btn-primary" onClick={() => void addMemory()} data-testid="knowledge-memory-add">
              Pin
            </button>
          </div>
          <ul>
            {memories.map((item) => (
              <li key={item.id} className="flex items-center gap-2 border-b border-divider py-2" data-testid="knowledge-memory-row">
                <span className="flex-1">{item.text}</span>
                {item.pinned ? <span className="tag tag-accent">Pinned</span> : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void apiFetch(`/api/v1/knowledge/memories/${item.id}`, { method: "DELETE" }).then(() => reload())}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "map" ? (
        <div className="flex flex-col gap-4" data-testid="knowledge-map-panel">
          <section className="blueprint p-[18px]">
            <p className="panel-label">Map</p>
            <p className="mt-2 text-[13px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
              This desk memory is what Chat retrieves now. Job modes will call the same retrieve later.
              Map reviews sources with your embedding, brain, and verifier models.
            </p>
            <button
              type="button"
              className="btn btn-primary mt-3 w-fit"
              disabled={mapping}
              onClick={() => void runMap()}
              data-testid="knowledge-map-run"
            >
              {mapping ? "Mapping…" : "Map knowledge"}
            </button>
          </section>
          {knowledgeMap ? (
            <section className="blueprint flex flex-col gap-3 p-[18px]" data-testid="knowledge-map">
              <div className="flex flex-wrap items-center gap-2">
                <span className={knowledgeMap.ready ? "tag tag-accent" : "tag tag-outline"}>
                  {knowledgeMap.ready ? "Ready" : "Not ready"}
                </span>
                <span className="tag tag-neutral">{knowledgeMap.source}</span>
              </div>
              <FormattedText text={knowledgeMap.overview} className="text-[14px]" />
              <ul className="flex flex-col gap-3">
                {knowledgeMap.topics.map((topic) => (
                  <li key={`${topic.title}-${topic.verdict}`} className="border-t border-divider pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{topic.title}</span>
                      <span className={verdictTagClass(topic.verdict)}>{topic.verdict}</span>
                    </div>
                    <FormattedText
                      text={topic.summary}
                      className="mt-1 text-[13px] text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]"
                    />
                    {topic.note ? (
                      <FormattedText
                        text={topic.note}
                        className="mt-1 text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {knowledgeMap.gaps.length > 0 ? (
                <div>
                  <p className="panel-label">Gaps</p>
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
