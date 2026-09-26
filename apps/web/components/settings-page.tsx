"use client";

import { useEffect, useState } from "react";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "@agentforge/core/media-kind";
import { AccountPlanPanel } from "./account-plan-panel";
import { AccountSessionRow } from "./account-session-row";
import { SettingsResetCard } from "./settings-reset-card";
// Phase 8: renders only where there is a ceiling to show (hosted); null on a desk.
import { SettingsStorageCard } from "./settings-storage-card";
import { UsagePanel, type AccountUsage } from "./usage-panel";
import { apiFetch, checkGateway, relaunchDesktopApp } from "@/lib/api-client";
import {
  formatGateTimestamp,
  gatewayReasonKey,
  gatewayStatusKey,
  parseGatewayBlocked,
  parseGatewayGate,
  type GatewayGatePayload,
  type GatewayGateStatus,
} from "@/lib/gateway-gate";
import { applyLocale, getLocale, LOCALE_RESTART_EVENT, t } from "@/lib/i18n";
import { ModeHeader } from "@/components/mode-header";
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

function runtimeStatusLabel(mode: "ai" | "stub"): string {
  return mode === "ai" ? t("settings.runtimeLive") : t("settings.runtimeStub");
}

/** What `/api/v1/settings` (and `apply-locale`) answer with. Every field is optional on the wire. */
export type SettingsPayload = {
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
  resetPending?: boolean;
};

/** One settings request's outcome: the payload, a closed gateway gate, or the sentence to show. */
export type SettingsAnswer =
  | { kind: "ok"; payload: SettingsPayload }
  | { kind: "blocked"; status: GatewayGateStatus }
  | { kind: "failed"; message: string };

type SettingsFailureKey = "settings.loadFailed" | "settings.saveFailed" | "settings.localeFailed";

function hostErrorMessage(body: unknown): string | null {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/**
 * Send one settings request and read its answer. Never throws: a request that did not come back, a
 * non-JSON error page and an error body all become `failed`, with the host's own message when it
 * sent one and the catalog's `fallbackKey` otherwise. Only a settings object is ever `ok`.
 */
export async function readSettingsAnswer(
  request: () => Promise<Response>,
  fallbackKey: SettingsFailureKey,
): Promise<SettingsAnswer> {
  let res: Response;
  try {
    res = await request();
  } catch {
    return { kind: "failed", message: t(fallbackKey) };
  }
  const body: unknown = await res.json().catch(() => null);
  const blocked = parseGatewayBlocked(body);
  if (blocked) {
    return { kind: "blocked", status: blocked.status };
  }
  if (!res.ok || !body || typeof body !== "object" || Array.isArray(body) || (body as { error?: unknown }).error) {
    return { kind: "failed", message: hostErrorMessage(body) ?? t(fallbackKey) };
  }
  return { kind: "ok", payload: body as SettingsPayload };
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
  const [localeSaving, setLocaleSaving] = useState(false);
  const [localeError, setLocaleError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A queued wipe the host will apply on the next launch; the reset card offers to call it off.
  const [resetPending, setResetPending] = useState(false);

  // Only the host label ever reaches the UI: the endpoint itself is pinned and stays hidden.
  const gatewayEndpoint = gateway?.endpoint ?? gatewayBaseUrl;
  const gatewayCheckedAt = formatGateTimestamp(gateway?.checkedAt, getLocale(), true);
  const gatewayLastOkAt = formatGateTimestamp(gateway?.lastOkAt, getLocale());
  const gatewayReason = gatewayReasonKey(gateway?.status);

  function applyPayload(payload: SettingsPayload) {
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
    setResetPending(payload.resetPending === true);
  }

  /** The sentence for an answer that did not land: a closed gate names its reason. */
  function answerError(answer: Exclude<SettingsAnswer, { kind: "ok" }>): string {
    return answer.kind === "blocked"
      ? t(gatewayReasonKey(answer.status) ?? "onboarding.gate.error", { gatewayName })
      : answer.message;
  }

  useEffect(() => {
    let cancelled = false;
    // A failed first load used to leave the defaults on screen as if they were this desk's settings.
    void readSettingsAnswer(() => apiFetch("/api/v1/settings"), "settings.loadFailed").then((answer) => {
      if (cancelled) {
        return;
      }
      if (answer.kind === "ok") {
        setLoadError(null);
        applyPayload(answer.payload);
        return;
      }
      setLoadError(answer.kind === "failed" ? answer.message : t("settings.loadFailed"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      // The endpoint is pinned by the host; never send it back.
      const answer = await readSettingsAnswer(
        () =>
          apiFetch("/api/v1/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              openaiApiKey,
              editTurnCapUsd,
            }),
          }),
        "settings.saveFailed",
      );
      if (answer.kind !== "ok") {
        setError(answerError(answer));
        return;
      }
      setOpenaiApiKey("");
      setGoogleApiKey("");
      setAnthropicApiKey("");
      setVolcengineApiKey("");
      setTavilyKey("");
      setBraveKey("");
      setFalKey("");
      applyPayload(answer.payload);
      setLoadError(null);
      setMessage(t("settings.saved"));
    } finally {
      setBusy(false);
    }
  }

  async function onLocaleChange(next: string) {
    if (!isAppLocale(next) || localeSaving) {
      return;
    }
    // The select shows the choice while it saves, and goes back if the save does not land.
    const previous = savedLocale;
    setSavedLocale(next);
    setLocaleError(null);
    setLocaleSaving(true);
    try {
      const answer = await readSettingsAnswer(
        () =>
          apiFetch("/api/v1/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: next }),
          }),
        "settings.localeFailed",
      );
      if (answer.kind !== "ok") {
        setSavedLocale(previous);
        setLocaleError(answerError(answer));
        return;
      }
      applyPayload(answer.payload);
    } finally {
      setLocaleSaving(false);
    }
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
    setLocaleError(null);
    setLocaleBusy(true);
    try {
      const answer = await readSettingsAnswer(
        () => apiFetch("/api/v1/settings/apply-locale", { method: "POST" }),
        "settings.localeFailed",
      );
      if (answer.kind !== "ok") {
        setLocaleError(answerError(answer));
        return;
      }
      applyPayload(answer.payload);
      applyLocale(answer.payload.locale);
      // A refused relaunch (installing an update, already quitting, webdev) must still reach the
      // in-app restart notice, or the language change would look like it did nothing.
      const relaunched = await relaunchDesktopApp();
      if (relaunched.ok) {
        return;
      }
      window.dispatchEvent(new Event(LOCALE_RESTART_EVENT));
    } finally {
      setLocaleBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[var(--content-narrow)] px-6 py-8 text-[var(--text)]">
      <ModeHeader
        icon="settings"
        title={t("settings.title")}
        outcomeTestId="settings-intro"
        outcome={t("settings.intro", {
          workspaceName,
          gatewayName,
          gatewayHost: gatewayHostLabel(gatewayEndpoint),
        })}
      />

      {loadError ? (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert" data-testid="settings-load-error">
          {loadError}
        </p>
      ) : null}

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
            disabled={localeSaving}
            data-testid="settings-locale"
          >
            <option value="en">{t("common.english")}</option>
            <option value="id">{t("common.bahasa")}</option>
          </select>
        </label>
        <p className="text-xs text-[var(--text-3)]">{t("settings.languageHelp")}</p>
        {localeError ? (
          <p className="text-sm text-[var(--danger)]" role="alert" data-testid="settings-locale-error">
            {localeError}
          </p>
        ) : null}
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
          {error ? (
            <p className="text-sm text-[var(--danger)]" role="alert" data-testid="settings-error">
              {error}
            </p>
          ) : null}
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
          {t("settings.privacy", { productName, gatewayName, gatewayHost: gatewayHostLabel(gatewayEndpoint) })}
        </p>
      </form>

      {/* Phase 9: who is signed in (lane C) and what this account is on (lane G). Both render
          nothing of substance where there is no session and no plan, which is every desk. */}
      <div className="mt-6">
        <AccountSessionRow />
      </div>
      <AccountPlanPanel />
      <SettingsStorageCard />
      <SettingsResetCard resetPending={resetPending} />
    </main>
  );
}
