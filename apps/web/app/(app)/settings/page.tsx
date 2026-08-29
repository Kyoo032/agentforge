"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "@agentforge/core";
import { GATEWAY_BASE_URL, GATEWAY_NAME } from "@agentforge/core/gateway";

type Probe = {
  openaiCount?: number;
  anthropicCount?: number;
  googleCount?: number;
  volcengineCount?: number;
  openaiError?: string;
  anthropicError?: string;
  googleError?: string;
  volcengineError?: string;
  detectedDialect?: string;
};

type ToolBackend = { id: string; label: string; envVars: string[]; urlVars: string[] };
type ToolCapability = { id: string; label: string; description: string; backends: ToolBackend[] };
type ToolRoute = { backend: string; source: "selection" | "autodetect"; ready: boolean };

const TOGGLEABLE_TOOLS = [
  { key: "web_search", label: "Web search" },
  { key: "image_generate", label: "Image generation" },
  { key: "video_generate", label: "Video generation" },
  { key: "calculator", label: "Calculator" },
  { key: "datetime", label: "Date & time" },
] as const;

const DEFAULT_IMAGE_MODELS = [DEFAULT_GATEWAY_IMAGE_MODEL];
const DEFAULT_VIDEO_MODELS = [DEFAULT_GATEWAY_VIDEO_MODEL, "seedance-2.0-mini"];

const fieldClass = "mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink";

export default function SettingsPage() {
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasAnthropic, setHasAnthropic] = useState(false);
  const [hasVolcengine, setHasVolcengine] = useState(false);
  const [runtime, setRuntime] = useState<"ai" | "stub">("stub");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [volcengineApiKey, setVolcengineApiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const [googleBaseUrl, setGoogleBaseUrl] = useState("");
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState("");
  const [volcengineBaseUrl, setVolcengineBaseUrl] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [braveKey, setBraveKey] = useState("");
  const [falKey, setFalKey] = useState("");
  const [toolBackends, setToolBackends] = useState<Record<string, string>>({});
  const [hasToolKeys, setHasToolKeys] = useState<Record<string, boolean>>({});
  const [toolCatalog, setToolCatalog] = useState<ToolCapability[]>([]);
  const [toolRoutes, setToolRoutes] = useState<Record<string, ToolRoute>>({});
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [imageGenModel, setImageGenModel] = useState(DEFAULT_GATEWAY_IMAGE_MODEL);
  const [videoGenModel, setVideoGenModel] = useState(DEFAULT_GATEWAY_VIDEO_MODEL);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyPayload(payload: {
    hasOpenai?: boolean;
    hasGoogle?: boolean;
    hasAnthropic?: boolean;
    hasVolcengine?: boolean;
    runtime?: string;
    openaiBaseUrl?: string;
    googleBaseUrl?: string;
    anthropicBaseUrl?: string;
    volcengineBaseUrl?: string;
    probe?: Probe;
    hasToolKeys?: Record<string, boolean>;
    toolBackends?: Record<string, string>;
    toolCatalog?: ToolCapability[];
    toolRoutes?: Record<string, ToolRoute>;
    imageGenModel?: string;
    videoGenModel?: string;
    disabledTools?: string[];
  }) {
    setHasOpenai(Boolean(payload.hasOpenai));
    setHasGoogle(Boolean(payload.hasGoogle));
    setHasAnthropic(Boolean(payload.hasAnthropic));
    setHasVolcengine(Boolean(payload.hasVolcengine));
    setRuntime(payload.runtime === "ai" ? "ai" : "stub");
    setOpenaiBaseUrl(typeof payload.openaiBaseUrl === "string" ? payload.openaiBaseUrl : "");
    setGoogleBaseUrl(typeof payload.googleBaseUrl === "string" ? payload.googleBaseUrl : "");
    setAnthropicBaseUrl(typeof payload.anthropicBaseUrl === "string" ? payload.anthropicBaseUrl : "");
    setVolcengineBaseUrl(typeof payload.volcengineBaseUrl === "string" ? payload.volcengineBaseUrl : "");
    setHasToolKeys(payload.hasToolKeys ?? {});
    setToolBackends(payload.toolBackends ?? {});
    setDisabledTools(Array.isArray(payload.disabledTools) ? payload.disabledTools : []);
    setImageGenModel(
      typeof payload.imageGenModel === "string" && payload.imageGenModel.trim()
        ? payload.imageGenModel.trim()
        : DEFAULT_GATEWAY_IMAGE_MODEL,
    );
    setVideoGenModel(
      typeof payload.videoGenModel === "string" && payload.videoGenModel.trim()
        ? payload.videoGenModel.trim()
        : DEFAULT_GATEWAY_VIDEO_MODEL,
    );
    if (payload.toolCatalog) {
      setToolCatalog(payload.toolCatalog);
    }
    if (payload.toolRoutes) {
      setToolRoutes(payload.toolRoutes);
    }
    if (payload.probe) {
      setProbe(payload.probe);
    }
  }

  async function reload() {
    const payload = await fetch("/api/v1/settings").then((res) => res.json());
    applyPayload(payload);
  }

  useEffect(() => {
    void reload();
  }, []);

  function setToolEnabled(toolKey: string, enabled: boolean) {
    setDisabledTools((current) => {
      const without = current.filter((item) => item !== toolKey);
      return enabled ? without : [...without, toolKey];
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const saved = await fetch("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openaiApiKey,
        googleApiKey,
        anthropicApiKey,
        volcengineApiKey,
        openaiBaseUrl,
        googleBaseUrl,
        anthropicBaseUrl,
        volcengineBaseUrl,
        toolKeys: {
          TAVILY_API_KEY: tavilyKey,
          BRAVE_SEARCH_API_KEY: braveKey,
          FAL_KEY: falKey,
        },
        toolBackends,
        imageGenModel,
        videoGenModel,
        disabledTools,
      }),
    }).then((res) => res.json());
    setBusy(false);
    if (saved.error) {
      setError(saved.error.message);
      return;
    }
    setOpenaiApiKey("");
    setGoogleApiKey("");
    setAnthropicApiKey("");
    setVolcengineApiKey("");
    setTavilyKey("");
    setBraveKey("");
    setFalKey("");
    applyPayload(saved);
    setMessage(summarizeProbe(saved.probe, "Saved."));
  }

  async function onRefresh() {
    setError(null);
    setMessage(null);
    setBusy(true);
    const refreshed = await fetch("/api/v1/models", { method: "POST" }).then((res) => res.json());
    setBusy(false);
    if (refreshed.error) {
      setError(refreshed.error.message);
      return;
    }
    setProbe(refreshed.probe ?? null);
    setMessage(summarizeProbe(refreshed.probe));
  }

  const imageModelOptions = modelOptions(DEFAULT_IMAGE_MODELS, imageGenModel);
  const videoModelOptions = modelOptions(DEFAULT_VIDEO_MODELS, videoGenModel);

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Settings</h1>
      <p className="mt-2 text-ink/60">
        Paste a {GATEWAY_NAME} gateway key to run chat, reasoning, tools, and image/video generation.
      </p>
      <p className="mt-2 text-sm text-ink/70">
        <Link href="/studio/new" className="underline" data-testid="settings-build-link">
          Build an agent
        </Link>
        {" · "}
        <Link href="/agents" className="underline" data-testid="settings-agents-link">
          Agents
        </Link>
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 space-y-6" data-testid="settings-form">
        <section className="space-y-4 rounded-xl border border-mist bg-paper p-5">
          <div>
            <h2 className="font-medium text-ink">{GATEWAY_NAME} gateway</h2>
            <p className="mt-1 text-xs text-ink/50">
              Home path is {GATEWAY_BASE_URL}. Change the URL only if you are pointing at another OpenAI-compatible
              host.
            </p>
          </div>
          <label className="block text-sm text-ink">
            Gateway URL
            <input
              className={fieldClass}
              type="text"
              autoComplete="off"
              placeholder={GATEWAY_BASE_URL}
              value={openaiBaseUrl}
              onChange={(event) => setOpenaiBaseUrl(event.target.value)}
              data-testid="openai-base-url"
            />
          </label>
          <label className="block text-sm text-ink">
            Gateway API key
            <input
              className={fieldClass}
              type="password"
              autoComplete="off"
              placeholder={hasOpenai ? "Saved — paste to replace" : "From your gateway dashboard"}
              value={openaiApiKey}
              onChange={(event) => setOpenaiApiKey(event.target.value)}
              data-testid="openai-key"
            />
          </label>
          {probe?.openaiError ? <p className="text-sm text-red-700">{probe.openaiError}</p> : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-ink/60">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
              data-testid="save-settings"
              disabled={busy}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-md border border-mist bg-paper px-4 py-2 text-ink disabled:opacity-50"
              data-testid="refresh-models"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              Detect models
            </button>
          </div>
        </section>

        <p className="text-sm text-ink/50" data-testid="privacy-note">
          Prompts leave this machine only over HTTPS to the saved endpoint. Agentforge does not log prompts. Keys and
          threads are encrypted on disk. Toko Token retention is the gateway&apos;s policy.
        </p>
        <p className="text-sm text-ink/50" data-testid="runtime-status">
          Runtime: {runtime}
          {hasOpenai ? " · Gateway key saved" : ""}
          {hasAnthropic ? " · Anthropic key saved" : ""}
          {hasGoogle ? " · Google key saved" : ""}
          {hasVolcengine ? " · Volcengine key saved" : ""}
          {probe?.detectedDialect ? ` · detected ${probe.detectedDialect}` : ""}
          {!hasOpenai && !hasGoogle && !hasAnthropic && !hasVolcengine ? " · no keys yet" : ""}
        </p>

        <details className="rounded-xl border border-mist bg-paper">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium text-ink marker:content-none [&::-webkit-details-marker]:hidden">
            Extras
          </summary>
          <div className="space-y-6 border-t border-mist px-5 py-5">
            <p className="text-xs text-ink/50">
              Other providers are optional. Use them only if you want native Anthropic, Google, or Volcengine instead of
              models already on the gateway. Search still needs Tavily or Brave. FAL is optional if you want that backend
              instead.
            </p>
            <fieldset className="space-y-3">
              <legend className="font-medium text-ink">Anthropic</legend>
              <label className="block text-sm text-ink">
                Endpoint URL
                <input
                  className={fieldClass}
                  type="text"
                  autoComplete="off"
                  placeholder="https://api.anthropic.com/v1"
                  value={anthropicBaseUrl}
                  onChange={(event) => setAnthropicBaseUrl(event.target.value)}
                  data-testid="anthropic-base-url"
                />
              </label>
              <label className="block text-sm text-ink">
                API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={hasAnthropic ? "Saved — paste to replace" : "sk-ant-..."}
                  value={anthropicApiKey}
                  onChange={(event) => setAnthropicApiKey(event.target.value)}
                  data-testid="anthropic-key"
                />
              </label>
              {probe?.anthropicError ? <p className="text-sm text-red-700">{probe.anthropicError}</p> : null}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-medium text-ink">Google</legend>
              <label className="block text-sm text-ink">
                Endpoint URL
                <input
                  className={fieldClass}
                  type="text"
                  autoComplete="off"
                  placeholder="https://generativelanguage.googleapis.com/v1beta"
                  value={googleBaseUrl}
                  onChange={(event) => setGoogleBaseUrl(event.target.value)}
                  data-testid="google-base-url"
                />
              </label>
              <label className="block text-sm text-ink">
                API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={hasGoogle ? "Saved — paste to replace" : "For Gemini models"}
                  value={googleApiKey}
                  onChange={(event) => setGoogleApiKey(event.target.value)}
                  data-testid="google-key"
                />
              </label>
              {probe?.googleError ? <p className="text-sm text-red-700">{probe.googleError}</p> : null}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-medium text-ink">Volcengine Ark</legend>
              <p className="text-xs text-ink/50">
                Doubao chat models and Seedance. Default endpoint is the Beijing Ark OpenAI-compatible API.
              </p>
              <label className="block text-sm text-ink">
                Endpoint URL
                <input
                  className={fieldClass}
                  type="text"
                  autoComplete="off"
                  placeholder="https://ark.cn-beijing.volces.com/api/v3"
                  value={volcengineBaseUrl}
                  onChange={(event) => setVolcengineBaseUrl(event.target.value)}
                  data-testid="volcengine-base-url"
                />
              </label>
              <label className="block text-sm text-ink">
                API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={hasVolcengine ? "Saved — paste to replace" : "ARK API key"}
                  value={volcengineApiKey}
                  onChange={(event) => setVolcengineApiKey(event.target.value)}
                  data-testid="volcengine-key"
                />
              </label>
              {probe?.volcengineError ? <p className="text-sm text-red-700">{probe.volcengineError}</p> : null}
            </fieldset>
            <fieldset className="space-y-3" data-testid="tool-keys">
              <legend className="font-medium text-ink">Tools</legend>
              <p className="text-xs text-ink/50">
                Generation uses these tools from chat. Attach a photo or video in the composer to analyze it.
              </p>
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Enable tools on this machine</p>
                {TOGGLEABLE_TOOLS.map((tool) => {
                  const enabled = !disabledTools.includes(tool.key);
                  return (
                    <label key={tool.key} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => setToolEnabled(tool.key, event.target.checked)}
                        data-testid={`tool-enabled-${tool.key}`}
                      />
                      {tool.label}
                    </label>
                  );
                })}
              </div>
              <label className="block text-sm text-ink">
                Default image model
                <select
                  className={fieldClass}
                  value={imageGenModel}
                  onChange={(event) => setImageGenModel(event.target.value)}
                  data-testid="image-gen-model"
                >
                  {imageModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-ink">
                Default video model
                <select
                  className={fieldClass}
                  value={videoGenModel}
                  onChange={(event) => setVideoGenModel(event.target.value)}
                  data-testid="video-gen-model"
                >
                  {videoModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink/50">
                Tool backends are sticky. Adding another key does not reroute. A missing key for the saved pick is an
                error, not a silent fallback.
              </p>
              {toolCatalog.map((capability) => (
                <label key={capability.id} className="block text-sm text-ink">
                  {capability.label} provider
                  <select
                    className={fieldClass}
                    value={toolBackends[capability.id] ?? ""}
                    onChange={(event) =>
                      setToolBackends((current) => ({ ...current, [capability.id]: event.target.value }))
                    }
                    data-testid={`${capability.id}-backend`}
                  >
                    <option value="">Auto (first dedicated key that is saved)</option>
                    {capability.backends.map((backend) => (
                      <option key={backend.id} value={backend.id}>
                        {backend.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="block text-sm text-ink">
                Tavily API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={hasToolKeys.TAVILY_API_KEY ? "Saved — paste to replace" : "tvly-..."}
                  value={tavilyKey}
                  onChange={(event) => setTavilyKey(event.target.value)}
                  data-testid="tavily-key"
                />
              </label>
              <label className="block text-sm text-ink">
                Brave Search API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={hasToolKeys.BRAVE_SEARCH_API_KEY ? "Saved — paste to replace" : "Optional"}
                  value={braveKey}
                  onChange={(event) => setBraveKey(event.target.value)}
                  data-testid="brave-key"
                />
              </label>
              <label className="block text-sm text-ink">
                FAL API key
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  placeholder={
                    hasToolKeys.FAL_KEY ? "Saved — paste to replace" : "Optional — only if you pick FAL for image/video"
                  }
                  value={falKey}
                  onChange={(event) => setFalKey(event.target.value)}
                  data-testid="fal-key"
                />
              </label>
              {(["web", "image_gen", "video_gen"] as const).map((id) => (
                <p key={id} className="text-xs text-ink/50" data-testid={`${id}-route`}>
                  {routeStatus(id, toolRoutes[id], toolCatalog.find((item) => item.id === id)?.label ?? id)}
                </p>
              ))}
            </fieldset>
          </div>
        </details>
      </form>
    </main>
  );
}

function modelOptions(defaults: string[], current: string): string[] {
  const trimmed = current.trim();
  if (!trimmed || defaults.includes(trimmed)) {
    return defaults;
  }
  return [trimmed, ...defaults];
}

function routeStatus(id: string, route: ToolRoute | undefined, label: string): string {
  if (route?.ready) {
    const how = route.source === "selection" ? "saved pick" : "auto";
    return `${label} uses ${route.backend} (${how}).`;
  }
  if (route?.source === "selection" && route.backend) {
    return `${label} is set to ${route.backend}, but that key is missing.`;
  }
  if (id === "web") {
    return "Web search is idle until a Tavily or Brave key is saved.";
  }
  if (id === "image_gen") {
    return "Image generation uses the gateway when a key is saved, or FAL / OpenAI Images if you pick them.";
  }
  return "Video generation uses the gateway when a key is saved, or FAL / Volcengine Seedance if you pick them.";
}

function summarizeProbe(probe: Probe | undefined, prefix = ""): string {
  if (!probe) {
    return prefix ? `${prefix} Keys stay on this machine.` : "No models loaded.";
  }
  const parts = [
    probe.openaiCount ? `${probe.openaiCount} gateway` : null,
    probe.anthropicCount ? `${probe.anthropicCount} Anthropic` : null,
    probe.googleCount ? `${probe.googleCount} Google` : null,
    probe.volcengineCount ? `${probe.volcengineCount} Volcengine` : null,
  ].filter(Boolean);
  const detected = probe.detectedDialect ? ` Detected ${probe.detectedDialect}.` : "";
  if (parts.length === 0) {
    return `${prefix} Keys stay on this machine.${detected}`.trim();
  }
  return `${prefix} Loaded ${parts.join(", ")}.${detected}`.replace(/\s+/g, " ").trim();
}
