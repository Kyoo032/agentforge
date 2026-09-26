"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelReset, relaunchDesktopApp, resetApp } from "@/lib/api-client";
import { hasDesktopShell, useHostCapabilities } from "@/lib/host-capabilities";
import { announceGate } from "@/lib/gateway-gate";
import { t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";
// The host owns the word (`@agentforge/core` once it exports it); this copy is the same literal.
import { RESET_CONFIRM_WORD } from "@/lib/reset-app";

/**
 * Start over — the two destructive doors out of a configured install.
 *
 * Neither one decides anything locally: the host deletes and answers with the
 * gate it now reports. Sign-out drops the app back to onboarding through
 * `announceGate`; a fresh install is applied by the host on the next boot, so
 * the app has to restart for it to take effect.
 *
 * Between the request and that boot the wipe is only *queued* (`resetPending`),
 * which is the owner's last chance to call it off — hence the banner.
 */

type Panel = "none" | "key" | "all" | "tenant";
type Outcome = "none" | "restarting" | "restartNeeded" | "pendingCancelled" | "erased";

export type SettingsResetCardProps = {
  /** From `GET /api/v1/settings`: a wipe is queued and will be applied by the next launch. */
  resetPending?: boolean;
};

const panelClass = "mt-3 space-y-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3";
const dangerButtonClass =
  "rounded-pill bg-[var(--danger)] px-3 py-1.5 text-sm text-[var(--surface)] disabled:opacity-50";
const cancelButtonClass = "rounded-md px-3 py-2 text-sm text-[var(--text-2)] underline disabled:opacity-50";
const rowButtonClass = "rounded-md px-2 py-1 text-sm text-[var(--danger)] underline disabled:opacity-50";

export function SettingsResetCard({ resetPending = false }: SettingsResetCardProps = {}) {
  const navigate = useNavigate();
  const { productName } = useProductBrand();
  /*
   * Phase 8 — the host decides which of the two destructive doors this target has, and it is never
   * both. `startOver` wipes the machine's whole data directory, which on a hosted box is every
   * tenant's work, so the hosted server says no to it and the desk says yes. `tenantReset` erases
   * the signed-in account and nobody else's, which only means anything where there is more than
   * one account, so the two flags are mirror images.
   *
   * Before ping answers, every capability is false and this card shows only "forget my key" —
   * which is the one row that is true on every target. A control that appears a moment late is
   * better than one that appears and then answers 403.
   */
  const capabilities = useHostCapabilities();
  const [panel, setPanel] = useState<Panel>("none");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("none");
  const [restartReason, setRestartReason] = useState<string | null>(null);
  const [pending, setPending] = useState(resetPending);

  // The settings payload arrives after the first render, so follow it until this card changes it.
  useEffect(() => {
    setPending(resetPending);
  }, [resetPending]);

  /** One place to read a relaunch answer, so a refusal never renders as "restarting". */
  async function requestRestart(): Promise<boolean> {
    const relaunched = await relaunchDesktopApp({ reset: true });
    if (relaunched.ok) {
      setRestartReason(null);
      setOutcome("restarting");
      return true;
    }
    // Webdev has no shell to ask; the operator restarts the dev server instead.
    setRestartReason(relaunched.reason === "unavailable" ? null : (relaunched.reason ?? null));
    setOutcome("restartNeeded");
    return false;
  }

  async function onCancelPending() {
    setError(null);
    setBusy(true);
    try {
      const result = await cancelReset();
      setPending(result.resetPending);
      if (!result.ok) {
        setError(result.error ?? t("settings.reset.failed"));
        return;
      }
      setRestartReason(null);
      setOutcome("pendingCancelled");
    } catch {
      setError(t("settings.reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onRestartPending() {
    setError(null);
    setBusy(true);
    try {
      await requestRestart();
    } finally {
      setBusy(false);
    }
  }

  function closePanel() {
    setPanel("none");
    setTyped("");
  }

  function openPanel(next: Panel) {
    setError(null);
    setOutcome("none");
    setRestartReason(null);
    setTyped("");
    setPanel(next);
  }

  async function onSignOut() {
    setError(null);
    setBusy(true);
    try {
      const result = await resetApp("key");
      if (!result.ok) {
        setError(result.error ?? t("settings.reset.failed"));
        return;
      }
      closePanel();
      // Leave the settings route first so the gate change does not unmount under it.
      void navigate("/chat");
      announceGate(result.gateway);
    } catch {
      setError(t("settings.reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Phase 8 — erase this account, on the hosted service.
   *
   * The host has already deleted the rows, the objects and the secrets and re-provisioned a clean
   * home desk by the time this answers, so there is nothing staged and nothing to restart: the
   * only thing left for the renderer to do is stop showing the old account. Navigating to `/chat`
   * before announcing the gate is the same order `onSignOut` uses, so the gate change does not
   * unmount the settings route from under itself.
   */
  async function onEraseAccount() {
    setError(null);
    setBusy(true);
    try {
      // What the owner actually typed, as everywhere else here: the host compares it, and sending
      // a constant would let a mismatched box through on the renderer's say-so instead of theirs.
      const result = await resetApp("tenant", typed.trim());
      if (!result.ok) {
        setError(result.error ?? t("settings.reset.failed"));
        return;
      }
      closePanel();
      setPending(false);
      setRestartReason(null);
      setOutcome("erased");
      void navigate("/chat");
      announceGate(result.gateway);
      // The desks, threads and artifacts every other screen is holding are gone. A shell refresh is
      // how the rest of the app is told to re-read them, and it is the event App.tsx already listens
      // for — this is the same thing a desk switch does, for the same reason.
      window.dispatchEvent(new Event("agentforge-shell-refresh"));
    } catch {
      setError(t("settings.reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onFreshInstall() {
    setError(null);
    setBusy(true);
    try {
      // Send what the owner actually typed: the host compares it, and a constant would let a
      // mismatched confirm box through on its say-so instead of theirs.
      const result = await resetApp("all", typed.trim());
      if (!result.ok) {
        setError(result.error ?? t("settings.reset.failed"));
        return;
      }
      closePanel();
      setPending(result.resetPending || result.relaunch);
      if (!result.relaunch) {
        setRestartReason(null);
        setOutcome("restartNeeded");
        return;
      }
      await requestRestart();
    } catch {
      setError(t("settings.reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="settings-reset"
    >
      <div>
        <h2 className="font-medium text-[var(--text)]">{t("settings.reset.heading")}</h2>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("settings.reset.help")}</p>
      </div>

      {pending ? (
        <div className={panelClass} data-testid="settings-reset-pending">
          <p className="text-sm text-[var(--text)]">{t("settings.reset.pending")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cancelButtonClass}
              data-testid="settings-reset-pending-cancel"
              disabled={busy}
              onClick={() => void onCancelPending()}
            >
              {t("settings.reset.pendingCancel")}
            </button>
            {hasDesktopShell(capabilities) ? (
              <button
                type="button"
                className={dangerButtonClass}
                data-testid="settings-reset-pending-restart"
                disabled={busy}
                onClick={() => void onRestartPending()}
              >
                {t("settings.reset.pendingRestart")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <details className="space-y-3" data-testid="settings-reset-danger">
        <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">
          {t("settings.reset.dangerSummary")}
        </summary>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">{t("settings.reset.signOut")}</p>
          <button
            type="button"
            className={rowButtonClass}
            data-testid="settings-reset-key"
            disabled={busy}
            onClick={() => openPanel("key")}
          >
            {t("settings.reset.signOutSubmit")}
          </button>
        </div>
        <p className="text-xs text-[var(--text-3)]">{t("settings.reset.signOutHelp")}</p>
        {panel === "key" ? (
          <div className={panelClass} data-testid="settings-reset-key-confirm">
            <p className="text-sm text-[var(--text)]">{t("settings.reset.signOutConfirm")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={dangerButtonClass}
                data-testid="settings-reset-key-submit"
                disabled={busy}
                onClick={() => void onSignOut()}
              >
                {t("settings.reset.signOutSubmit")}
              </button>
              <button
                type="button"
                className={cancelButtonClass}
                data-testid="settings-reset-cancel"
                disabled={busy}
                onClick={closePanel}
              >
                {t("settings.reset.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {capabilities.startOver ? (
      <div className="space-y-1 border-t border-[var(--line)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">{t("settings.reset.freshInstall")}</p>
          <button
            type="button"
            className={rowButtonClass}
            data-testid="settings-reset-all"
            disabled={busy}
            onClick={() => openPanel("all")}
          >
            {t("settings.reset.freshInstallSubmit")}
          </button>
        </div>
        <p className="text-xs text-[var(--text-3)]">{t("settings.reset.freshInstallHelp", { productName })}</p>
        {panel === "all" ? (
          <div className={panelClass} data-testid="settings-reset-all-confirm">
            <p className="text-sm text-[var(--text)]">{t("settings.reset.freshInstallWarning", { productName })}</p>
            <p className="text-sm text-[var(--text-2)]">{t("settings.reset.freshInstallTypeToConfirm")}</p>
            <input
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={RESET_CONFIRM_WORD}
              data-testid="settings-reset-all-confirm-name"
              autoComplete="off"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={dangerButtonClass}
                data-testid="settings-reset-all-submit"
                disabled={busy || typed.trim() !== RESET_CONFIRM_WORD}
                onClick={() => void onFreshInstall()}
              >
                {t("settings.reset.freshInstallSubmit")}
              </button>
              <button
                type="button"
                className={cancelButtonClass}
                data-testid="settings-reset-cancel"
                disabled={busy}
                onClick={closePanel}
              >
                {t("settings.reset.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      {/* Phase 8: the hosted account erase. Owner-only on the host; the flag is false on a desk. */}
      {capabilities.tenantReset ? (
        <div className="space-y-1 border-t border-[var(--line)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--text)]">{t("settings.reset.eraseAccount")}</p>
            <button
              type="button"
              className={rowButtonClass}
              data-testid="settings-reset-tenant"
              disabled={busy}
              onClick={() => openPanel("tenant")}
            >
              {t("settings.reset.eraseAccountSubmit")}
            </button>
          </div>
          <p className="text-xs text-[var(--text-3)]">{t("settings.reset.eraseAccountHelp")}</p>
          {panel === "tenant" ? (
            <div className={panelClass} data-testid="settings-reset-tenant-confirm">
              <p className="text-sm text-[var(--text)]">{t("settings.reset.eraseAccountWarning")}</p>
              <p className="text-sm text-[var(--text-2)]">{t("settings.reset.freshInstallTypeToConfirm")}</p>
              <input
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={RESET_CONFIRM_WORD}
                data-testid="settings-reset-tenant-confirm-name"
                autoComplete="off"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={dangerButtonClass}
                  data-testid="settings-reset-tenant-submit"
                  disabled={busy || typed.trim() !== RESET_CONFIRM_WORD}
                  onClick={() => void onEraseAccount()}
                >
                  {t("settings.reset.eraseAccountSubmit")}
                </button>
                <button
                  type="button"
                  className={cancelButtonClass}
                  data-testid="settings-reset-cancel"
                  disabled={busy}
                  onClick={closePanel}
                >
                  {t("settings.reset.cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      </details>

      {error ? (
        <p className="text-sm text-[var(--danger)]" data-testid="settings-reset-error">
          {error}
        </p>
      ) : null}
      {outcome === "restarting" ? (
        <p className="text-sm text-[var(--text-2)]" data-testid="settings-reset-restarting">
          {t("settings.reset.restarting", { productName })}
        </p>
      ) : null}
      {outcome === "restartNeeded" ? (
        <p className="text-sm text-[var(--text-2)]" data-testid="settings-reset-restart-needed">
          {restartReason
            ? t("settings.reset.restartRefused", { productName, reason: restartReason })
            : t("settings.reset.restartNeeded", { productName })}
        </p>
      ) : null}
      {outcome === "erased" ? (
        <p className="text-sm text-[var(--text-2)]" data-testid="settings-reset-erased">
          {t("settings.reset.eraseAccountDone")}
        </p>
      ) : null}
      {outcome === "pendingCancelled" ? (
        <p className="text-sm text-[var(--text-2)]" data-testid="settings-reset-pending-cancelled">
          {t("settings.reset.pendingCancelled")}
        </p>
      ) : null}
    </section>
  );
}
