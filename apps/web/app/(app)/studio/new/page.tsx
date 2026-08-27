"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/model-select";

type Tool = { key: string; name: string; description: string; pack?: string };

type AgentTemplate = {
  key: string;
  pack: string;
  packLabel: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  inputModalities: string[];
  toolKeys: string[];
};

type AgentPack = { id: string; label: string; templates: AgentTemplate[] };

type ModelProvider = "openai" | "anthropic" | "google" | "volcengine";

type ChatModel = {
  id: string;
  label: string;
  provider?: ModelProvider;
  inputModalities: string[];
};

const BLANK_PROMPT = "You are a helpful assistant. Be clear and direct.";

const fieldClass =
  "mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink outline-none focus:border-navy";

const chipBase = "rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-navy bg-navy text-white";
const chipOff = "border-mist bg-paper text-ink hover:bg-mist";

export default function NewAgentPage() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [packs, setPacks] = useState<AgentPack[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(BLANK_PROMPT);
  const [model, setModel] = useState("");
  const [modalities, setModalities] = useState<string[]>(["text"]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => packs.flatMap((pack) => pack.templates).find((item) => item.key === templateKey),
    [packs, templateKey],
  );
  const visibleTools = useMemo(
    () => tools.filter((tool) => !tool.pack || tool.pack === selectedTemplate?.pack),
    [tools, selectedTemplate],
  );

  useEffect(() => {
    void (async () => {
      const context = await fetch("/api/v1/context").then((res) => res.json());
      setWorkspaceId(context.tenant.workspaceId);
      const [catalog, modelPayload, templatePayload] = await Promise.all([
        fetch("/api/v1/tools").then((res) => res.json()),
        fetch("/api/v1/models").then((res) => res.json()),
        fetch("/api/v1/templates").then((res) => res.json()),
      ]);
      setTools(catalog.tools ?? []);
      const packsList: AgentPack[] = templatePayload.packs ?? [];
      setPacks(packsList);
      const available: ChatModel[] = modelPayload.models ?? [];
      setModels(available);
      const preferred = typeof modelPayload.defaultModel === "string" ? modelPayload.defaultModel : "";
      const starter = packsList.flatMap((pack) => pack.templates).find((item) => item.key === "default");
      if (starter) {
        applyTemplate(starter, available);
      } else {
        setModel(available.some((item) => item.id === preferred) ? preferred : (available[0]?.id ?? ""));
      }
    })();
  }, []);

  function applyBlank() {
    setTemplateKey("");
    setName("");
    setDescription("");
    setSystemPrompt(BLANK_PROMPT);
    setModalities(["text"]);
    setSelectedTools([]);
  }

  function applyTemplate(template: AgentTemplate, available: ChatModel[]) {
    setTemplateKey(template.key);
    setName(template.name);
    setDescription(template.description);
    setSystemPrompt(template.systemPrompt);
    setModalities(template.inputModalities);
    setSelectedTools(template.toolKeys);
    if (available.some((item) => item.id === template.model)) {
      setModel(template.model);
    } else if (available[0]) {
      setModel(available[0].id);
    }
  }

  function toggleModality(value: string) {
    setModalities((current) => {
      if (value === "text") {
        return current;
      }
      return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId) {
      setError("Workspace is still loading. Try again.");
      return;
    }
    setError(null);
    const created = await fetch(`/api/v1/workspaces/${workspaceId}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        systemPrompt,
        model,
        inputModalities: modalities,
      }),
    }).then((res) => res.json());
    if (created.error) {
      setError(created.error.message);
      return;
    }
    for (const toolKey of selectedTools) {
      await fetch(`/api/v1/agents/${created.agent.id}/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolKey }),
      });
    }
    await fetch(`/api/v1/agents/${created.agent.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: created.version.id }),
    });
    router.push(`/studio/${created.agent.id}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">Build · a desk, not a form</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">New desk</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/60">
        Start blank, or optionally use a template. Chat itself stays a general assistant on the gateway — templates
        are only starters for specialists you choose to build.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-6" data-testid="create-agent-form">
        <fieldset className="text-sm" data-testid="template-picker">
          <legend className="font-medium text-ink">Template (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${chipBase} ${templateKey === "" ? chipOn : chipOff}`}
              data-testid="template-blank"
              onClick={applyBlank}
            >
              Blank
            </button>
            {packs.flatMap((pack) =>
              pack.templates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className={`${chipBase} ${templateKey === template.key ? chipOn : chipOff}`}
                  data-testid={`template-${template.key}`}
                  title={template.description}
                  onClick={() => applyTemplate(template, models)}
                >
                  {pack.label}
                </button>
              )),
            )}
          </div>
        </fieldset>

        <div className="grid gap-8 md:grid-cols-2">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-ink">Identity</h2>
            <label className="block text-sm text-ink">
              Name
              <input
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                data-testid="agent-name"
              />
            </label>
            <label className="block text-sm text-ink">
              Description
              <input
                className={fieldClass}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                data-testid="agent-description"
              />
            </label>
            <label className="block text-sm text-ink">
              Instructions
              <textarea
                className={`${fieldClass} min-h-32`}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                required
                data-testid="agent-prompt"
              />
            </label>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-ink">Instruments</h2>
            <label className="block text-sm text-ink">
              Model
              <ModelSelect
                models={models}
                value={model}
                onChange={setModel}
                showModalities
                className={fieldClass}
              />
            </label>
            <fieldset className="text-sm">
              <legend className="font-medium text-ink">Input modalities</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {["text", "image", "video"].map((item) => {
                  const on = modalities.includes(item);
                  const locked = item === "text";
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`${chipBase} ${on ? chipOn : chipOff} ${locked ? "cursor-default" : ""}`}
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => toggleModality(item)}
                      data-testid={`modality-${item}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="text-sm">
              <legend className="font-medium text-ink">Tools</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {visibleTools.map((tool) => {
                  const on = selectedTools.includes(tool.key);
                  return (
                    <button
                      key={tool.key}
                      type="button"
                      className={`${chipBase} ${on ? chipOn : chipOff}`}
                      aria-pressed={on}
                      title={tool.description}
                      onClick={() =>
                        setSelectedTools((current) =>
                          current.includes(tool.key)
                            ? current.filter((key) => key !== tool.key)
                            : [...current, tool.key],
                        )
                      }
                      data-testid={`tool-${tool.key}`}
                    >
                      {tool.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </section>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="create-agent"
            disabled={!workspaceId || !model}
          >
            Create, bind, and publish
          </button>
        </div>
      </form>
    </main>
  );
}
