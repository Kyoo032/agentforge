import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { FfmpegSetupNotice } from "@/components/ffmpeg-setup-notice";
import { fetchEditDoctor, type EditDoctor } from "@/lib/edit-client";
import { gatewayHostLabel, useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";

type Props = {
  onDone: () => void;
  onOffline: () => void;
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

export function OnboardingScreen({ onDone, onOffline }: Props) {
  const { productName, gatewayName, gatewayBaseUrl } = useProductBrand();
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<EditDoctor | null>(null);

  useEffect(() => {
    void fetchEditDoctor().then((report) => {
      if (report) {
        setDoctor(report);
      }
    });
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const saved = await apiFetch("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openaiApiKey }),
    }).then((res) => res.json());
    setBusy(false);
    if (saved.error) {
      setError(saved.error.message);
      return;
    }
    onDone();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-8 text-[var(--text)]">
      <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
        {t("onboarding.welcome", { productName })}
      </h1>
      <p className="mt-2 text-[var(--text-2)]">{t("onboarding.intro", { gatewayName })}</p>
      {doctor?.ffmpeg?.found === false ? (
        <section
          className="mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
          data-testid="onboarding-setup-check"
        >
          <h2 className="border-b border-[var(--line)] px-4 py-2 text-sm font-semibold">
            {t("onboarding.setupCheck")}
          </h2>
          <FfmpegSetupNotice doctor={doctor} onDoctor={setDoctor} variant="full" />
          <p className="px-4 py-2 text-xs text-[var(--text-2)]">{t("onboarding.ffmpegLater")}</p>
        </section>
      ) : null}
      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 space-y-4" data-testid="onboarding-form">
        <label className="block text-sm">
          {t("onboarding.endpointLabel")}
          <input className={fieldClass} value={gatewayBaseUrl} readOnly data-testid="onboarding-endpoint" />
        </label>
        <p className="text-xs text-[var(--text-3)]">{gatewayHostLabel(gatewayBaseUrl)}</p>
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
          <button
            type="button"
            className="rounded-md border border-[var(--line)] px-4 py-2 text-[var(--text)]"
            onClick={onOffline}
            data-testid="onboarding-offline"
          >
            {t("onboarding.offline")}
          </button>
        </div>
      </form>
    </main>
  );
}
