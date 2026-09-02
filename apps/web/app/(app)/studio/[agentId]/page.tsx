"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import { ModelSelect } from "@/components/model-select";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  friendlyLabel?: string;
  bestFor?: string;
  tier?: "everyday" | "advanced";
};

type Tool = { key: string; name: string; description: string; pack?: string };

type AgentPayload = {
  agent: {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: "private" | "workspace";
    currentVersionId: string | null;
  };
  versions: Array<{
    id: string;
    version: number;
    systemPrompt: string;
    model: string;
    inputModalities: string[];
    productModes?: ProductMode[] | null;
    config?: { imageGenModel?: string; videoGenModel?: string };
  }>;
  publishedBindings: Array<{ toolKey: string }>;
  draftBindings: Array<{ toolKey: string }>;
  isDefaultChat?: boolean;
};

const chipBase = "rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-navy bg-navy text-white";
const chipOff = "border-mist bg-paper text-ink hover:bg-mist";
const fieldClass =
  "mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink outline-none focus:border-navy";

export default function StudioAgentPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const [data, setData] = useState<AgentPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [productModes, setProductModes] = useState<ProductMode[]>([]);
  const [savingModes, setSavingModes] = useState(false);
  const [imageModels, setImageModels] = useState<StudioModel[]>([]);
  const [videoModels, setVideoModels] = useState<StudioModel[]>([]);
  const [chatModels, setChatModels] = useState<StudioModel[]>([]);
  const [imageGenModel, setImageGenModel] = useState("");
  const [videoGenModel, setVideoGenModel] = useState("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [savingSoul, setSavingSoul] = useState(false);
  const [soulMessage, setSoulMessage] = useState<string | null>(null);
  const [soulError, setSoulError] = useState<string | null>(null);

  const published = useMemo(() => {
    if (!data?.agent.currentVersionId) {
      return null;
    }
    return data.versions.find((version) => version.id === data.agent.currentVersionId) ?? null;
  }, [data]);

  const isDefaultChat = Boolean(data?.isDefaultChat);

  function applySoulFromPayload(payload: AgentPayload) {
    const current = payload.versions?.find(
      (version) => version.id === payload.agent?.currentVersionId,
    );
    setSystemPrompt(typeof current?.systemPrompt === "string" ? current.systemPrompt : "");
    setModel(typeof current?.model === "string" ? current.model : "");
    setSelectedTools(
      Array.isArray(payload.publishedBindings)
        ? payload.publishedBindings.map((binding) => binding.toolKey)
        : [],
    );
  }

  async function reload() {
    const payload = (await fetch(`/api/v1/agents/${params.agentId}`).then((res) =>
      res.json(),
    )) as AgentPayload;
    setData(payload);
    const current = payload.versions?.find(
      (version) => version.id === payload.agent?.currentVersionId,
    );
    const stored = current?.productModes;
    setProductModes(Array.isArray(stored) && stored.length > 0 ? stored : ["chat"]);
    setImageGenModel(typeof current?.config?.imageGenModel === "string" ? current.config.imageGenModel : "");
    setVideoGenModel(typeof current?.config?.videoGenModel === "string" ? current.config.videoGenModel : "");
    applySoulFromPayload(payload);
  }

  useEffect(() => {
    void reload();
    router.refresh();
  }, [params.agentId]);

  useEffect(() => {
    void (async () => {
      const [modelPayload, toolCatalog] = await Promise.all([
        fetch("/api/v1/models").then((res) => res.json()),
        fetch("/api/v1/tools").then((res) => res.json()),
      ]);
      setImageModels(modelPayload.modes?.image ?? []);
      setVideoModels(modelPayload.modes?.video ?? []);
      setChatModels(modelPayload.models ?? []);
      setTools(toolCatalog.tools ?? []);
    })();
  }, []);

  function toggleProductMode(id: ProductMode) {
    setProductModes((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        return next.length > 0 ? next : current;
      }
      return PRODUCT_MODES.map((mode) => mode.id).filter((item) => item === id || current.includes(item));
    });
  }

  function toggleTool(key: string) {
    setSelectedTools((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  async function saveSoul() {
    setSavingSoul(true);
    setSoulMessage(null);
    setSoulError(null);
    const saved = await fetch(`/api/v1/agents/${params.agentId}/soul`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt,
        model,
        toolKeys: selectedTools,
      }),
    }).then((res) => res.json());
    setSavingSoul(false);
    if (saved.error) {
      setSoulError(saved.error.message ?? "Failed to save soul");
      return;
    }
    const versionNumber = saved.version?.version;
    setSoulMessage(typeof versionNumber === "number" ? `Published v${versionNumber}` : "Published");
    router.refresh();
    await reload();
  }

  async function saveModes() {
    setSavingModes(true);
    setMessage(null);
    const saved = await fetch(`/api/v1/agents/${params.agentId}/product-modes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productModes }),
    }).then((res) => res.json());
    setSavingModes(false);
    if (saved.error) {
      setMessage(saved.error.message);
      return;
    }
    setMessage("Product surfaces saved");
    router.refresh();
    await reload();
  }

  async function saveGenerateDefaults() {
    setSavingModes(true);
    setMessage(null);
    const saved = await fetch(`/api/v1/agents/${params.agentId}/generate-defaults`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageGenModel: productModes.includes("images") ? imageGenModel : "",
        videoGenModel: productModes.includes("videos") ? videoGenModel : "",
      }),
    }).then((res) => res.json());
    setSavingModes(false);
    if (saved.error) {
      setMessage(saved.error.message);
      return;
    }
    setMessage("Generate defaults saved");
    await reload();
  }

  async function share(visibility: "private" | "workspace") {
    await fetch(`/api/v1/agents/${params.agentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    setMessage(visibility === "workspace" ? "Shared with workspace" : "Now private");
    await reload();
  }

  if (!data?.agent) {
    return <main className="px-6 py-10">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink" data-testid="studio-agent-name">
        {data.agent.name}
      </h1>
      <p className="mt-2 text-ink/60">{data.agent.description}</p>
      <p className="mt-4 text-sm text-ink" data-testid="visibility">
        Visibility: {data.agent.visibility}
      </p>
      <p className="text-sm text-ink">Published: {data.agent.currentVersionId ? "yes" : "no"}</p>
      <p className="mt-2 text-sm text-ink">Tools: {data.draftBindings.map((binding) => binding.toolKey).join(", ") || "none"}</p>

      {!isDefaultChat ? (
        <fieldset className="mt-8 text-sm">
          <legend className="font-medium text-ink">Soul</legend>
          <p className="mt-1 text-xs text-ink/50">
            Instructions, model, and tools. Save publishes a new version — it does not rewrite the current one in
            place.
          </p>
          <label className="mt-3 block text-ink">
            Instructions
            <textarea
              className={`${fieldClass} min-h-32`}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              data-testid="agent-prompt"
            />
          </label>
          <label className="mt-3 block text-ink">
            Model
            <ModelSelect
              models={chatModels}
              value={model}
              onChange={setModel}
              testId="studio-model-picker"
              showModalities
              className={fieldClass}
            />
          </label>
          <div className="mt-3">
            <p className="font-medium text-ink">Tools</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tools.map((tool) => {
                const on = selectedTools.includes(tool.key);
                return (
                  <button
                    key={tool.key}
                    type="button"
                    className={`${chipBase} ${on ? chipOn : chipOff}`}
                    aria-pressed={on}
                    title={tool.description}
                    onClick={() => toggleTool(tool.key)}
                    data-testid={`tool-${tool.key}`}
                  >
                    {tool.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="mt-3 rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
            onClick={() => void saveSoul()}
            disabled={savingSoul || !published || !model}
            data-testid="save-soul"
          >
            {savingSoul ? "Saving…" : "Save soul"}
          </button>
          {soulMessage ? <p className="mt-2 text-sm text-ink">{soulMessage}</p> : null}
          {soulError ? <p className="mt-2 text-sm text-red-700">{soulError}</p> : null}
        </fieldset>
      ) : null}

      <fieldset className="mt-8 text-sm">
        <legend className="font-medium text-ink">Product surfaces</legend>
        <p className="mt-1 text-xs text-ink/50">These tabs appear on the left rail for this workspace.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRODUCT_MODES.map((mode) => {
            const on = productModes.includes(mode.id);
            return (
              <button
                key={mode.id}
                type="button"
                className={`${chipBase} ${on ? chipOn : chipOff}`}
                aria-pressed={on}
                onClick={() => toggleProductMode(mode.id)}
                data-testid={`product-mode-${mode.id}`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-3 rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
          onClick={() => void saveModes()}
          disabled={savingModes || !published}
          data-testid="save-product-modes"
        >
          {savingModes ? "Saving…" : "Save surfaces"}
        </button>
      </fieldset>

      {productModes.includes("images") || productModes.includes("videos") ? (
        <fieldset className="mt-8 text-sm">
          <legend className="font-medium text-ink">Generate defaults</legend>
          <p className="mt-1 text-xs text-ink/50">
            Pins for Images / Videos studios and this agent’s generate tools. Empty inherits Settings.
          </p>
          {productModes.includes("images") ? (
            <label className="mt-3 block">
              Default image model
              <ModelSelect
                models={imageModels}
                value={imageGenModel}
                onChange={setImageGenModel}
                testId="agent-image-model"
                className="mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink"
              />
            </label>
          ) : null}
          {productModes.includes("videos") ? (
            <label className="mt-3 block">
              Default video model
              <ModelSelect
                models={videoModels}
                value={videoGenModel}
                onChange={setVideoGenModel}
                testId="agent-video-model"
                className="mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink"
              />
            </label>
          ) : null}
          <button
            type="button"
            className="mt-3 rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
            onClick={() => void saveGenerateDefaults()}
            disabled={savingModes || !published}
            data-testid="save-generate-defaults"
          >
            {savingModes ? "Saving…" : "Save generate defaults"}
          </button>
        </fieldset>
      ) : null}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-navy px-4 py-2 text-white"
          onClick={() => void share("workspace")}
          data-testid="share-workspace"
        >
          Share with workspace
        </button>
        <button type="button" className="rounded-md border border-mist px-4 py-2 text-ink" onClick={() => void share("private")}>
          Make private
        </button>
        <Link href={`/agents/${data.agent.id}`} className="rounded-md px-4 py-2 underline">
          Open chat
        </Link>
      </div>
      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </main>
  );
}
