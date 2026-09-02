"use client";

import { useEffect, useState } from "react";
import { GATEWAY_NAME } from "@agentforge/core/gateway";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "@agentforge/core/media-kind";
import { UsagePanel, type AccountUsage } from "./usage-panel";

type Probe = {
  openaiCount?: number;
  anthropicCount?: number;
  googleCount?: number;
  volcengineCount?: number;
  totalCount?: number;
  chatCount?: number;
  imageCount?: number;
  videoCount?: number;
  detectedDialect?: string;
};

const fieldClass = "mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink";

function runtimeStatusLabel(mode: "ai" | "stub"): string {
  return mode === "ai" ? "Live" : "Offline demo";
}

export default function SettingsPage() {
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasAnthropic, setHasAnthropic] = useState(false);
  const [hasVolcengine, setHasVolcengine] = useState(false);
  const [openaiKeyFingerprint, setOpenaiKeyFingerprint] = useState<string | null>(null);
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
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [injectionGuardBypass, setInjectionGuardBypass] = useState(false);
  const [imageGenModel, setImageGenModel] = useState(DEFAULT_GATEWAY_IMAGE_MODEL);
  const [videoGenModel, setVideoGenModel] = useState(DEFAULT_GATEWAY_VIDEO_MODEL);
  const [documentGenModel, setDocumentGenModel] = useState("");
  const [researchGenModel, setResearchGenModel] = useState("");
  const [presentationGenModel, setPresentationGenModel] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<AccountUsage | null>(null);

  function applyPayload(payload: {
    hasOpenai?: boolean;
    hasGoogle?: boolean;
    hasAnthropic?: boolean;
    hasVolcengine?: boolean;
    openaiKeyFingerprint?: string | null;
    runtime?: string;
    openaiBaseUrl?: string;
    googleBaseUrl?: string;
    anthropicBaseUrl?: string;
    volcengineBaseUrl?: string;
    probe?: Probe;
    toolBackends?: Record<string, string>;
    imageGenModel?: string;
    videoGenModel?: string;
    documentGenModel?: string;
    researchGenModel?: string;
    presentationGenModel?: string;
    disabledTools?: string[];
    injectionGuardBypass?: boolean;
    defaults?: {
      image?: string;
      video?: string;
      documents?: string;
      research?: string;
      presentations?: string;
    };
    usage?: AccountUsage;
  }) {
    setHasOpenai(Boolean(payload.hasOpenai));
    setHasGoogle(Boolean(payload.hasGoogle));
    setHasAnthropic(Boolean(payload.hasAnthropic));
    setHasVolcengine(Boolean(payload.hasVolcengine));
    setOpenaiKeyFingerprint(
      typeof payload.openaiKeyFingerprint === "string" && payload.openaiKeyFingerprint.trim()
        ? payload.openaiKeyFingerprint.trim()
        : null,
    );
    setRuntime(payload.runtime === "ai" ? "ai" : "stub");
    setOpenaiBaseUrl(typeof payload.openaiBaseUrl === "string" ? payload.openaiBaseUrl : "");
    setGoogleBaseUrl(typeof payload.googleBaseUrl === "string" ? payload.googleBaseUrl : "");
    setAnthropicBaseUrl(typeof payload.anthropicBaseUrl === "string" ? payload.anthropicBaseUrl : "");
    setVolcengineBaseUrl(typeof payload.volcengineBaseUrl === "string" ? payload.volcengineBaseUrl : "");
    setToolBackends(payload.toolBackends ?? {});
    setDisabledTools(Array.isArray(payload.disabledTools) ? payload.disabledTools : []);
    setInjectionGuardBypass(payload.injectionGuardBypass === true);
    setImageGenModel(
      typeof payload.imageGenModel === "string" && payload.imageGenModel.trim()
        ? payload.imageGenModel.trim()
        : payload.defaults?.image || DEFAULT_GATEWAY_IMAGE_MODEL,
    );
    setVideoGenModel(
      typeof payload.videoGenModel === "string" && payload.videoGenModel.trim()
        ? payload.videoGenModel.trim()
        : payload.defaults?.video || DEFAULT_GATEWAY_VIDEO_MODEL,
    );
    setDocumentGenModel(
      typeof payload.documentGenModel === "string" && payload.documentGenModel.trim()
        ? payload.documentGenModel.trim()
        : payload.defaults?.documents || "",
    );
    setResearchGenModel(
      typeof payload.researchGenModel === "string" && payload.researchGenModel.trim()
        ? payload.researchGenModel.trim()
        : payload.defaults?.research || "",
    );
    setPresentationGenModel(
      typeof payload.presentationGenModel === "string" && payload.presentationGenModel.trim()
        ? payload.presentationGenModel.trim()
        : payload.defaults?.presentations || "",
    );
    if (payload.probe) {
      setProbe(payload.probe);
    }
    if (payload.usage) {
      setUsage(payload.usage);
    }
  }

  useEffect(() => {
    void fetch("/api/v1/settings")
      .then((res) => res.json())
      .then(applyPayload);
  }, []);

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
        documentGenModel,
        researchGenModel,
        presentationGenModel,
        disabledTools,
        injectionGuardBypass,
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
    setMessage("Saved. Keys stay on this machine.");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Settings</h1>
      <p className="mt-2 text-ink/60">
        Paste your {GATEWAY_NAME} API key from api.tokotokenai.com to use chat, documents, research, images, videos,
        and presentation on this machine.
      </p>

      <p className="mt-3 text-sm text-ink/50" data-testid="runtime-status">
        Status: {runtimeStatusLabel(runtime)}
        {hasOpenai ? " · Gateway key saved" : ""}
        {hasAnthropic ? " · Anthropic key saved" : ""}
        {hasGoogle ? " · Google key saved" : ""}
        {hasVolcengine ? " · Volcengine key saved" : ""}
        {probe?.detectedDialect ? ` · detected ${probe.detectedDialect}` : ""}
        {!hasOpenai && !hasGoogle && !hasAnthropic && !hasVolcengine ? " · no keys yet" : ""}
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-6" data-testid="settings-form">
        <section className="space-y-4 rounded-xl border border-mist bg-paper p-5">
          <div>
            <h2 className="font-medium text-ink">{GATEWAY_NAME} gateway</h2>
            <p className="mt-1 text-xs text-ink/50">Paste your gateway API key. It never comes back after save.</p>
          </div>
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
          {hasOpenai && openaiKeyFingerprint ? (
            <p className="mt-1 text-xs text-ink/50" data-testid="key-fingerprint">
              Saved key fingerprint {openaiKeyFingerprint}
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-ink/60">{message}</p> : null}
          <UsagePanel usage={usage} />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
              data-testid="save-settings"
              disabled={busy}
            >
              Save
            </button>
          </div>
        </section>

        <p className="text-sm text-ink/50" data-testid="privacy-note">
          Prompts leave this machine only over HTTPS to the saved endpoint. Agentforge does not log prompts. Keys and
          threads are encrypted on disk. Toko Token retention is the gateway&apos;s policy.
        </p>
      </form>
    </main>
  );
}
