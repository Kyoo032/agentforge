"use client";

import { useEffect, useState } from "react";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "@agentforge/core/media-kind";
import { UsagePanel, type AccountUsage } from "./usage-panel";
import { apiFetch, checkGateway, relaunchDesktopApp } from "@/lib/api-client";
import {
  formatGateTimestamp,
  gatewayReasonKey,
  gatewayStatusKey,
  parseGatewayBlocked,
  parseGatewayGate,
  type GatewayGatePayload,
} from "@/lib/gateway-gate";
import { applyLocale, getLocale, LOCALE_RESTART_EVENT, t } from "@/lib/i18n";
import { isAppLocale, parseAppLocale, type AppLocale } from "@agentforge/core/locale";
import { gatewayHostLabel, useProductBrand } from "@/lib/product-brand";
import { useWorkspaceScope } from "@/lib/workspace-scope";

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

const fieldClass =
  "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

/** The pinned endpoint is text, not an input: the owner cannot change it. */
const readOnlyFieldClass = `${fieldClass} break-all text-[var(--text-2)]`;

function runtimeStatusLabel(mode: "ai" | "stub"): string {
  return mode === "ai" ? t("settings.runtimeLive") : t("settings.runtimeStub");
}

export function SettingsPage() {
  const { productName, gatewayName, gatewayBaseUrl } = useProductBrand();
  const { name: workspaceName } = useWorkspaceScope();
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
  const [gateway, setGateway] = useState<GatewayGatePayload | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);
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
  const [editTurnCapUsd, setEditTurnCapUsd] = useState(2);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [locale, setLocale] = useState<AppLocale>("en");
  const [savedLocale, setSavedLocale] = useState<AppLocale>("en");
  const [localeBusy, setLocaleBusy] = useState(false);

  const gatewayEndpoint = gateway?.endpoint ?? gatewayBaseUrl;
  const gatewayCheckedAt = formatGateTimestamp(gateway?.checkedAt, getLocale(), true);
  const gatewayLastOkAt = formatGateTimestamp(gateway?.lastOkAt, getLocale());
  const gatewayReason = gatewayReasonKey(gateway?.status);

  function applyPayload(payload: {
    hasOpenai?: boolean;
    hasGoogle?: boolean;
    hasAnthropic?: boolean;
    hasVolcengine?: boolean;
    openaiKeyFingerprint?: string | null;
    runtime?: string;
    gateway?: unknown;
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
    editTurnCapUsd?: number;
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
    locale?: string;
    savedLocale?: string;
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
    setGateway(parseGatewayGate(payload.gateway));
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
    setEditTurnCapUsd(
      typeof payload.editTurnCapUsd === "number" && Number.isFinite(payload.editTurnCapUsd)
        ? Math.min(50, Math.max(0.5, payload.editTurnCapUsd))
        : 2,
    );
    if (payload.probe) {
      setProbe(payload.probe);
    }
    if (payload.usage) {
      setUsage(payload.usage);
    }
    setLocale(parseAppLocale(payload.locale));
    setSavedLocale(parseAppLocale(payload.savedLocale ?? payload.locale));
  }

  useEffect(() => {
    void apiFetch("/api/v1/settings")
      .then((res) => res.json())
      .then(applyPayload);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    // The endpoint is pinned by the host; never send it back.
    const saved = await apiFetch("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openaiApiKey,
        editTurnCapUsd,
      }),
    }).then((res) => res.json());
    setBusy(false);
    const blocked = parseGatewayBlocked(saved);
    if (blocked) {
      setError(t(gatewayReasonKey(blocked.status) ?? "onboarding.gate.error", { gatewayName }));
      return;
    }
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
    setMessage(t("settings.saved"));
  }

  async function onLocaleChange(next: string) {
    if (!isAppLocale(next)) {
      return;
    }
    setSavedLocale(next);
    setError(null);
    const saved = await apiFetch("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).then((res) => res.json());
    if (saved.error) {
      setError(saved.error.message);
      return;
    }
    applyPayload(saved);
  }

  async function onRecheckGateway() {
    setError(null);
    setMessage(null);
    setGatewayBusy(true);
    try {
      const next = await checkGateway();
      if (next) {
        setGateway(next);
      } else {
        setError(t("settings.gateway.checkFailed"));
      }
    } catch {
      setError(t("settings.gateway.checkFailed"));
    } finally {
      setGatewayBusy(false);
    }
  }

  async function onRestart() {
    setError(null);
    setLocaleBusy(true);
    try {
      const applied = await apiFetch("/api/v1/settings/apply-locale", { method: "POST" }).then((res) =>
        res.json(),
      );
      if (applied.error) {
        setError(applied.error.message);
        return;
      }
      applyPayload(applied);
      applyLocale(applied.locale);
      if (relaunchDesktopApp()) {
        return;
      }
      window.dispatchEvent(new Event(LOCALE_RESTART_EVENT));
    } finally {
      setLocaleBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-8 text-[var(--text)]">
      <div className="kicker">{t("settings.kicker", { workspaceName })}</div>
      <h1 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("settings.title")}</h1>
      <p className="mt-2 text-[13px] text-[var(--text-2)]">
        {t("settings.intro", {
          workspaceName,
          gatewayName,
          gatewayHost: gatewayHostLabel(gatewayEndpoint),
        })}
      </p>

      <p className="mt-3 text-sm text-[var(--text-3)]" data-testid="runtime-status">
        {t("settings.status", {
          details: [
            runtimeStatusLabel(runtime),
            hasOpenai ? t("settings.keyGateway") : null,
            hasAnthropic ? t("settings.keyAnthropic") : null,
            hasGoogle ? t("settings.keyGoogle") : null,
            hasVolcengine ? t("settings.keyVolcengine") : null,
            probe?.detectedDialect ? t("settings.detected", { dialect: probe.detectedDialect }) : null,
            !hasOpenai && !hasGoogle && !hasAnthropic && !hasVolcengine ? t("settings.noKeys") : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
      </p>

      <section className="mt-6 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <label className="block text-sm text-[var(--text)]">
          {t("settings.languageLabel")}
          <select
            className={fieldClass}
            value={savedLocale}
            onChange={(event) => void onLocaleChange(event.target.value)}
            data-testid="settings-locale"
          >
            <option value="en">{t("common.english")}</option>
            <option value="id">{t("common.bahasa")}</option>
          </select>
        </label>
        <p className="text-xs text-[var(--text-3)]">{t("settings.languageHelp")}</p>
        {savedLocale !== locale ? (
          <div className="space-y-2" data-testid="settings-locale-restart">
            <p className="text-sm text-[var(--text-2)]">{t("common.restartHint")}</p>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="settings-locale-restart-button"
              onClick={() => void onRestart()}
              disabled={localeBusy}
            >
              {t("common.restartApp")}
            </button>
          </div>
        ) : null}
      </section>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-6" data-testid="settings-form">
        <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="font-medium text-[var(--text)]">{t("settings.gatewayHeading", { gatewayName })}</h2>
            <p className="mt-1 text-xs text-[var(--text-3)]">{t("settings.gatewayHelp")}</p>
          </div>
          <div className="block text-sm text-[var(--text)]">
            {t("settings.endpointLabel")}
            <p className={readOnlyFieldClass} data-testid="settings-endpoint">
              {gatewayEndpoint}
            </p>
          </div>
          <p className="-mt-2 text-xs text-[var(--text-3)]">{t("settings.endpointLocked")}</p>
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-3)]"
            data-testid="settings-gateway-status"
          >
            {gateway ? <span>{t(gatewayStatusKey(gateway.status))}</span> : null}
            {gatewayCheckedAt ? <span>{t("settings.gateway.lastChecked", { date: gatewayCheckedAt })}</span> : null}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-[var(--text)] disabled:opacity-50"
              onClick={() => void onRecheckGateway()}
              disabled={gatewayBusy}
              data-testid="settings-gateway-recheck"
            >
              {t("settings.gateway.recheck")}
            </button>
          </div>
          {gateway?.grace && gatewayLastOkAt ? (
            <p className="-mt-2 text-xs text-[var(--text-2)]" data-testid="settings-gateway-grace">
              {t("settings.gateway.grace", { date: gatewayLastOkAt })}
            </p>
          ) : null}
          {gatewayReason ? (
            <p className="-mt-2 text-sm text-[var(--danger)]" data-testid="settings-gateway-reason">
              {t(gatewayReason, { gatewayName })}
            </p>
          ) : null}
          <label className="block text-sm text-[var(--text)]">
            {t("settings.keyLabel")}
            <input
              className={fieldClass}
              type="password"
              autoComplete="off"
              placeholder={hasOpenai ? t("settings.keyPlaceholderSaved") : t("settings.keyPlaceholderEmpty")}
              value={openaiApiKey}
              onChange={(event) => setOpenaiApiKey(event.target.value)}
              data-testid="openai-key"
            />
          </label>
          <label className="block text-sm text-[var(--text)]">
            {t("settings.editCapLabel")}
            <input
              className={fieldClass}
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={editTurnCapUsd}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                setEditTurnCapUsd(Math.min(50, Math.max(0.5, next)));
              }}
              data-testid="settings-edit-turn-cap"
            />
          </label>
          {hasOpenai && openaiKeyFingerprint ? (
            <p className="mt-1 text-xs text-[var(--text-3)]" data-testid="key-fingerprint">
              {t("settings.fingerprint", { fingerprint: openaiKeyFingerprint })}
            </p>
          ) : null}
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          {message ? <p className="text-sm text-[var(--text-2)]">{message}</p> : null}
          <UsagePanel usage={usage} />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="btn btn-primary disabled:opacity-50"
              data-testid="save-settings"
              disabled={busy}
            >
              {t("settings.save")}
            </button>
          </div>
        </section>

        <p className="text-sm text-[var(--text-3)]" data-testid="privacy-note">
          {t("settings.privacy", { productName, gatewayName })}
        </p>
      </form>
    </main>
  );
}
