"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FormattedText } from "@/components/formatted-text";
import { MascotSlot } from "@/components/mascot-slot";
import { KnowledgeGraphPanel } from "@/components/knowledge-graph-panel";
import { KnowledgeLoop } from "@/components/knowledge-loop";
import { ModeHeader } from "@/components/mode-header";
import { ModelSelect } from "@/components/model-select";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { apiFetch } from "@/lib/api-client";
import { KNOWLEDGE_UPLOAD_ACCEPT, KNOWLEDGE_UPLOAD_FORMATS } from "@/lib/knowledge-upload";
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

/** The slice of `apiFetch` the page's writes use, so a test can hand it a stub. */
export type KnowledgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type KnowledgeOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string };

/**
 * One Knowledge write, in the order SR-45 set for the recording upload: `res.ok` before the body,
 * an error body read with a catch, and a dead network reported rather than thrown. Pin memory used
 * to clear its draft without looking at the answer at all, so a refused pin read as a saved one;
 * the callers now keep the draft unless this says `ok`.
 */
export async function sendKnowledge(
  path: string,
  init: RequestInit,
  fallback: string,
  fetcher: KnowledgeFetch = apiFetch,
): Promise<KnowledgeOutcome> {
  let res: Response;
  try {
    res = await fetcher(path, init);
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : fallback };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: { message?: unknown } } | null)?.error?.message;
    return { ok: false, message: typeof message === "string" && message.trim() ? message : fallback };
  }
  return { ok: true, data };
}

export type SubmitGuard<K extends string> = {
  /** Run `task` unless `key` is already in flight. Resolves true when it ran, false when dropped. */
  readonly run: (key: K, task: () => Promise<void>) => Promise<boolean>;
  readonly isBusy: (key: K) => boolean;
};

/**
 * At most one of each action in flight. A second press while the first is still out is dropped:
 * Add URL and Index paste could be pressed twice and indexed the same source twice. The set is
 * checked synchronously, so a double click cannot slip in before React re-renders the button as
 * disabled; `onChange` hears every change so the buttons can show it.
 */
export function createSubmitGuard<K extends string>(onChange: (busy: ReadonlySet<K>) => void): SubmitGuard<K> {
  let busy: ReadonlySet<K> = new Set();
  const update = (next: ReadonlySet<K>) => {
    busy = next;
    onChange(next);
  };
  return {
    isBusy: (key) => busy.has(key),
    run: async (key, task) => {
      if (busy.has(key)) {
        return false;
      }
      update(new Set([...busy, key]));
      try {
        await task();
        return true;
      } finally {
        update(new Set([...busy].filter((item) => item !== key)));
      }
    },
  };
}

type KnowledgeAction = "url" | "paste" | "file" | "memory";

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
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
  const [inFlight, setInFlight] = useState<ReadonlySet<KnowledgeAction>>(() => new Set());
  const guardRef = useRef<SubmitGuard<KnowledgeAction> | null>(null);
  if (!guardRef.current) {
    guardRef.current = createSubmitGuard<KnowledgeAction>(setInFlight);
  }
  const guard = guardRef.current;

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

  /** After a write landed: show it, or say the list could not be read back. */
  async function reloadAfterWrite() {
    try {
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("knowledge.errors.load"));
    }
  }

  // Each write below keeps its draft unless the host said yes, and runs at most once at a time.
  // A draft edited while its write was out is the owner's new text, so only an unchanged one clears.

  async function addUrl() {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    await guard.run("url", async () => {
      setError(null);
      const outcome = await sendKnowledge(
        "/api/v1/knowledge/sources/url",
        jsonPost({ url }),
        t("knowledge.errors.addUrl"),
      );
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setUrlDraft((current) => (current.trim() === url ? "" : current));
      await reloadAfterWrite();
    });
  }

  async function addPaste() {
    const text = pasteDraft.trim();
    if (!text) {
      return;
    }
    await guard.run("paste", async () => {
      setError(null);
      const outcome = await sendKnowledge(
        "/api/v1/knowledge/sources",
        jsonPost({ name: t("knowledge.sources.pastedName"), text }),
        t("knowledge.errors.addNotes"),
      );
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setPasteDraft((current) => (current.trim() === text ? "" : current));
      await reloadAfterWrite();
    });
  }

  async function addFile(file: File) {
    await guard.run("file", async () => {
      setError(null);
      const form = new FormData();
      form.set("file", file);
      const outcome = await sendKnowledge(
        "/api/v1/knowledge/sources",
        { method: "POST", body: form },
        t("knowledge.errors.indexFile"),
      );
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      await reloadAfterWrite();
    });
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
    await guard.run("memory", async () => {
      setError(null);
      const outcome = await sendKnowledge(
        "/api/v1/knowledge/memories",
        jsonPost({ text, pinned: true }),
        t("knowledge.errors.addMemory"),
      );
      if (!outcome.ok) {
        // The draft stays: a refused pin used to vanish as if it had been saved.
        setError(outcome.message);
        return;
      }
      setMemoryDraft((current) => (current.trim() === text ? "" : current));
      await reloadAfterWrite();
    });
  }

  return (
    <main
      data-mode="knowledge"
      className="mx-auto w-full max-w-[var(--content-wide)] px-6 py-8 text-[var(--text)]"
      data-testid="knowledge-page"
    >
      <div className="mb-5">
        <ModeHeader
          icon="knowledge"
          title={t("knowledge.title")}
          outcome={t("knowledge.intro", { name: workspaceName })}
          actions={
            <div className="seg" data-testid="knowledge-tabs">
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
          }
        />
      </div>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <section
        className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        data-testid="knowledge-models"
      >
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
          <MascotSlot
            mode="knowledge"
            placement={sources.some((row) => row.status === "Indexing") ? "beside" : "empty"}
            busy={sources.some((row) => row.status === "Indexing")}
            phase={sources.some((row) => row.status === "Indexing") ? "indexing" : undefined}
          />
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
                disabled={inFlight.has("url")}
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
                disabled={inFlight.has("paste")}
                data-testid="knowledge-add-paste"
              >
                {t("knowledge.sources.indexPaste")}
              </button>
              <label
                className={`btn btn-secondary ${inFlight.has("file") ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
              >
                {t("knowledge.sources.uploadFile")}
                <input
                  className="sr-only"
                  type="file"
                  accept={KNOWLEDGE_UPLOAD_ACCEPT}
                  disabled={inFlight.has("file")}
                  data-testid="knowledge-file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      void addFile(file);
                    }
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--text-3)]" data-testid="knowledge-file-formats">
              {t("knowledge.sources.uploadHint", { formats: KNOWLEDGE_UPLOAD_FORMATS })}
            </p>
          </section>
          <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            {sources.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid="knowledge-source-row">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tag tag-neutral" data-testid="knowledge-source-type">
                  {labeled(`knowledge.sourceType.${row.type}`, row.type)}
                </span>
                <span className="text-xs">
                  {t(row.chunks === 1 ? "knowledge.sources.chunksOne" : "knowledge.sources.chunks", {
                    count: row.chunks,
                  })}
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
              disabled={inFlight.has("memory")}
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
            <p className="mt-2 max-w-[var(--content-narrow)] text-[13px] text-[var(--text-2)]">
              {t("knowledge.map.intro")}
            </p>
            {/* The model walkthrough is method, not outcome; it sits one click away. */}
            <details className="mt-2 rounded-lg border border-[var(--line)] px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
                {t("knowledge.map.howItWorks")}
              </summary>
              <p className="mt-2 max-w-[var(--content-narrow)] text-xs text-[var(--text-3)]">
                {t("knowledge.map.howItWorksBody")}
              </p>
            </details>
            <button
              type="button"
              className="btn btn-primary mt-3 w-fit"
              disabled={mapping}
              onClick={() => void runMap()}
              data-testid="knowledge-map-run"
            >
              {mapping ? (
                <>
                  {t("knowledge.map.running")}
                  <span className="pulse-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </>
              ) : (
                t("knowledge.map.run")
              )}
            </button>
          </section>
          {knowledgeMap ? (
            <section
              className="enter-rise flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
              data-testid="knowledge-map"
            >
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
                {knowledgeMap.topics.map((topic, index) => (
                  <li
                    key={`${topic.title}-${topic.verdict}`}
                    className="card-live enter-rise px-4 py-3"
                    style={{ "--i": index } as CSSProperties}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{topic.title}</span>
                      <span className={verdictTagClass(topic.verdict)}>
                        {labeled(`knowledge.verdict.${topic.verdict}`, topic.verdict)}
                      </span>
                    </div>
                    <FormattedText text={topic.summary} className="mt-1 text-[13px] text-[var(--text)]" />
                    {topic.note ? (
                      <FormattedText text={topic.note} className="mt-1 text-xs text-[var(--text-2)]" />
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
