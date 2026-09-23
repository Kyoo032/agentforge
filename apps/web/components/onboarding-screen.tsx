import { useEffect, useState } from "react";
import { apiFetch, checkGateway, isElectron } from "@/lib/api-client";
import { ComponentSetupPanel } from "@/components/component-setup";
import { FfmpegSetupNotice } from "@/components/ffmpeg-setup-notice";
import { OnboardingDesks } from "@/components/onboarding-desks";
import { useComponentSetup } from "@/lib/use-component-setup";
import { fetchEditDoctor, type EditDoctor } from "@/lib/edit-client";
import {
  gatewayReasonKey,
  parseGatewayBlocked,
  parseGatewayGate,
  resolveGate,
  type GatewayGatePayload,
} from "@/lib/gateway-gate";
import { fetchOtherDesks, openDesk, type OnboardingDesk } from "@/lib/onboarding-desks";
import { gatewayHostLabel, useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";

type Props = {
  onDone: () => void;
  /** Gate the host reported at boot, so the user sees why they were sent back. */
  gateway?: GatewayGatePayload | null;
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

export function OnboardingScreen({ onDone, gateway }: Props) {
  const { productName, gatewayName, gatewayBaseUrl } = useProductBrand();
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<GatewayGatePayload | null>(gateway ?? null);
  const [doctor, setDoctor] = useState<EditDoctor | null>(null);
  // The other desks on this install, so a desk with no key of its own is never a dead end.
  const [desks, setDesks] = useState<OnboardingDesk[]>([]);
  // Optional native components install themselves here; the panel shows nothing when there is
  // nothing to install, and neither it nor ffmpeg ever gates the key form below.
  const componentSetup = useComponentSetup();
  const needsFfmpeg = doctor?.ffmpeg?.found === false;

  // Pinned by the host and never editable here: only its host label is shown, never the full URL.
  const endpoint = gate?.endpoint ?? gateway?.endpoint ?? gatewayBaseUrl;
  const reasonKey = gatewayReasonKey(gate?.status);

  useEffect(() => {
    void fetchOtherDesks().then(setDesks);
  }, []);

  useEffect(() => {
    void fetchEditDoctor().then((report) => {
      if (report) {
        setDoctor(report);
      }
    });
  }, []);

  function applyGate(next: GatewayGatePayload | null): boolean {
    setGate(next);
    if (resolveGate(next, isElectron()) === "app") {
      onDone();
      return true;
    }
    if (!next) {
      setError(t("onboarding.gate.error"));
    }
    return false;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey }),
      });
      const saved = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const blocked = parseGatewayBlocked(saved);
      if (blocked) {
        setGate(null);
        setError(t(gatewayReasonKey(blocked.status) ?? "onboarding.gate.error", { gatewayName }));
        return;
      }
      const failed = saved?.error as { message?: string } | undefined;
      if (failed) {
        setGate(null);
        setError(failed.message ?? t("onboarding.gate.error"));
        return;
      }
      applyGate(parseGatewayGate(saved?.gateway));
    } catch {
      setGate(null);
      setError(t("onboarding.gate.unreachable", { gatewayName }));
    } finally {
      setBusy(false);
    }
  }

  async function onRecheck() {
    setError(null);
    setBusy(true);
    try {
      applyGate(await checkGateway());
    } catch {
      setError(t("onboarding.gate.unreachable", { gatewayName }));
    } finally {
      setBusy(false);
    }
  }

  async function onOpenDesk(id: string) {
    setError(null);
    setBusy(true);
    try {
      if (!applyGate(await openDesk(id))) {
        // That desk is closed too; the host has already switched to it, so list the rest again.
        setDesks(await fetchOtherDesks());
      }
    } catch {
      setError(t("onboarding.desks.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-8 text-[var(--text)]">
      <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
        {t("onboarding.welcome", { productName })}
      </h1>
      <p className="mt-2 text-[var(--text-2)]">{t("onboarding.intro", { gatewayName })}</p>
      {needsFfmpeg || componentSetup.visible ? (
        <section
          className="mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
          data-testid="onboarding-setup-check"
        >
          <h2 className="border-b border-[var(--line)] px-4 py-2 text-sm font-semibold">
            {t("onboarding.setupCheck")}
          </h2>
          {needsFfmpeg && doctor ? (
            <>
              <FfmpegSetupNotice doctor={doctor} onDoctor={setDoctor} variant="full" />
              <p className="px-4 py-2 text-xs text-[var(--text-2)]">{t("onboarding.ffmpegLater")}</p>
            </>
          ) : null}
          <ComponentSetupPanel view={componentSetup} />
        </section>
      ) : null}
      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 space-y-4" data-testid="onboarding-form">
        <p className="text-xs text-[var(--text-3)]" data-testid="onboarding-gateway-host">
          {t("onboarding.gatewayHost", { host: gatewayHostLabel(endpoint) })}
        </p>
        {reasonKey ? (
          <p className="text-sm text-[var(--danger)]" data-testid="onboarding-gate-reason">
            {t(reasonKey, { gatewayName })}
          </p>
        ) : null}
        <label className="block text-sm">
          {t("onboarding.keyLabel")}
          <input
            className={fieldClass}
            type="password"
            autoComplete="off"
            placeholder={t("onboarding.keyPlaceholder")}
            value={openaiApiKey}
            onChange={(event) => setOpenaiApiKey(event.target.value)}
            data-testid="onboarding-key"
          />
        </label>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="btn btn-primary disabled:opacity-50"
            disabled={busy || !openaiApiKey.trim()}
            data-testid="onboarding-continue"
          >
            {t("onboarding.continue")}
          </button>
          {reasonKey ? (
            <button
              type="button"
              className="rounded-md border border-[var(--line)] px-4 py-2 text-[var(--text)] disabled:opacity-50"
              onClick={() => void onRecheck()}
              disabled={busy}
              data-testid="onboarding-recheck"
            >
              {t("settings.gateway.recheck")}
            </button>
          ) : null}
        </div>
      </form>
      <OnboardingDesks desks={desks} busy={busy} onOpen={(id) => void onOpenDesk(id)} />
    </main>
  );
}
