import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { FfmpegSetupNotice } from "@/components/ffmpeg-setup-notice";
import { fetchEditDoctor, type EditDoctor } from "@/lib/edit-client";
import { gatewayHostLabel, useProductBrand } from "@/lib/product-brand";

type Props = {
  onDone: () => void;
  onOffline: () => void;
};

const fieldClass = "mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink";

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
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold">Welcome to {productName}</h1>
      <p className="mt-2 text-ink/60">
        Paste your {gatewayName} API key. Chat and job modes run on this machine. You can change the endpoint later in
        Settings.
      </p>
      {doctor?.ffmpeg?.found === false ? (
        <section className="mt-6 overflow-hidden rounded-md border border-mist" data-testid="onboarding-setup-check">
          <h2 className="border-b border-divider px-4 py-2 text-sm font-semibold">Setup check</h2>
          <FfmpegSetupNotice doctor={doctor} onDoctor={setDoctor} variant="full" />
          <p className="px-4 py-2 text-xs text-ink/60">
            You can continue now and install ffmpeg later; the Edit studio shows the same guide until it is found.
          </p>
        </section>
      ) : null}
      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 space-y-4" data-testid="onboarding-form">
        <label className="block text-sm">
          Endpoint URL
          <input className={fieldClass} value={gatewayBaseUrl} readOnly data-testid="onboarding-endpoint" />
        </label>
        <p className="text-xs text-ink/50">{gatewayHostLabel(gatewayBaseUrl)}</p>
        <label className="block text-sm">
          API key
          <input
            className={fieldClass}
            type="password"
            autoComplete="off"
            placeholder="From your gateway dashboard"
            value={openaiApiKey}
            onChange={(event) => setOpenaiApiKey(event.target.value)}
            data-testid="onboarding-key"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-md bg-navy px-4 py-2 text-white disabled:opacity-50"
            disabled={busy || !openaiApiKey.trim()}
            data-testid="onboarding-continue"
          >
            Continue to Chat
          </button>
          <button
            type="button"
            className="rounded-md border border-mist px-4 py-2 text-ink"
            onClick={onOffline}
            data-testid="onboarding-offline"
          >
            Use offline demo
          </button>
        </div>
      </form>
    </main>
  );
}
