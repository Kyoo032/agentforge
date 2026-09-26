import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/brand-mark";
import { ComponentSetupPanel } from "@/components/component-setup";
import { FfmpegSetupNotice } from "@/components/ffmpeg-setup-notice";
import { FloatingShapes } from "@/components/floating-shapes";
import { ModeIcon, type ModeIconName } from "@/components/mode-icons";
import { OnboardingDesks } from "@/components/onboarding-desks";
import { apiFetch, checkGateway, isElectron } from "@/lib/api-client";
import { fetchEditDoctor, type EditDoctor } from "@/lib/edit-client";
import {
  gatewayReasonKey,
  parseGatewayBlocked,
  parseGatewayGate,
  resolveGate,
  type GatewayGatePayload,
} from "@/lib/gateway-gate";
import { t } from "@/lib/i18n";
import { fetchOtherDesks, openDesk, type OnboardingDesk } from "@/lib/onboarding-desks";
import { useProductBrand } from "@/lib/product-brand";
import { useComponentSetup } from "@/lib/use-component-setup";

type Props = {
  onDone: () => void;
  /** Gate the host reported at boot, so the user sees why they were sent back. */
  gateway?: GatewayGatePayload | null;
};

type Step = "welcome" | "key" | "try";

const EXAMPLES = ["chat", "document", "finance", "images"] as const;

const EXAMPLE_MODE: Record<(typeof EXAMPLES)[number], ModeIconName> = {
  chat: "chat",
  document: "documents",
  finance: "finance",
  images: "images",
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

/**
 * First step is the hello. A desk the host already closed lands on the key, because that is the
 * reason they are here. The examples come only after the host says the key is allowed.
 */
function openingStep(gateway: GatewayGatePayload | null | undefined): Step {
  return gatewayReasonKey(gateway?.status) ? "key" : "welcome";
}

function StepHero({ title, body, mode }: { title: string; body: string; mode?: ModeIconName }) {
  return (
    <div className="hero-aurora enter-rise relative flex flex-col items-center px-6 py-8 text-center" data-mode={mode}>
      <FloatingShapes layout="hero" />
      <span className="enter-pop relative" style={{ "--i": 1 } as CSSProperties}>
        <BrandMark orb size={52} />
      </span>
      <h1
        className="enter-rise relative mt-4 font-heading text-[30px] font-bold leading-[var(--lh-tight)] tracking-[var(--track)] text-[var(--text)] sm:text-[34px]"
        style={{ "--i": 2 } as CSSProperties}
      >
        <span className="text-gradient">{title}</span>
      </h1>
      <p className="enter-fade relative mt-2 max-w-prose text-[var(--text-2)]" style={{ "--i": 3 } as CSSProperties}>
        {body}
      </p>
    </div>
  );
}

export function OnboardingScreen({ onDone, gateway }: Props) {
  const navigate = useNavigate();
  const { productName, gatewayName } = useProductBrand();
  const [step, setStep] = useState<Step>(() => openingStep(gateway));
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
  const reasonKey = gatewayReasonKey(gate?.status);
  const reasonText = error ?? (reasonKey ? t(reasonKey, { gatewayName }) : null);

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
    setError(null);
    // The host said this desk may work. Show what to try, then the last button opens Chat.
    if (resolveGate(next, isElectron()) === "app") {
      setStep("try");
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
        // Catalog copy only. The host message can name the endpoint, and this screen does not.
        setGate(null);
        setError(t("onboarding.gate.error"));
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

  function finish() {
    navigate("/chat", { replace: true });
    onDone();
  }

  return (
    <main className="h-full overflow-y-auto text-[var(--text)]">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col justify-center px-6 py-10">
      <ol
        className="enter-fade mb-6 flex flex-wrap justify-center gap-2 text-xs"
        data-testid="onboarding-steps"
        aria-label={t("onboarding.stepsLabel")}
      >
        {(["welcome", "key", "try"] as const).map((id, index) => (
          <li
            key={id}
            data-testid={`onboarding-step-${id}`}
            aria-current={step === id ? "step" : undefined}
            className={
              step === id
                ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)]"
                : "px-3 py-1 text-[var(--text-3)]"
            }
          >
            {index + 1}. {t(`onboarding.steps.${id}`)}
          </li>
        ))}
      </ol>

      {step === "welcome" ? (
        <section data-testid="onboarding-welcome">
          <StepHero
            mode="chat"
            title={t("onboarding.welcome", { productName })}
            body={t("onboarding.intro", { productName })}
          />
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep("key")}
              data-testid="onboarding-next"
            >
              {t("onboarding.next")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "key" ? (
        <>
          <StepHero
            mode="settings"
            title={t("onboarding.keyTitle", { gatewayName })}
            body={t("onboarding.keyHelp", { productName, gatewayName })}
          />
          {needsFfmpeg || componentSetup.visible ? (
            <section
              className="enter-rise mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-elev-2"
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
          <form
            onSubmit={(event) => void onSubmit(event)}
            className="enter-rise mt-6 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-elev-2"
            data-testid="onboarding-form"
          >
            {reasonText ? (
              <p
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--danger)]"
                data-testid="onboarding-gate-reason"
              >
                {reasonText}
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
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn" onClick={() => setStep("welcome")} data-testid="onboarding-back">
                {t("onboarding.back")}
              </button>
              <button
                type="submit"
                className="btn btn-primary disabled:opacity-50"
                disabled={busy || !openaiApiKey.trim()}
                data-testid="onboarding-continue"
              >
                {t("onboarding.continue")}
              </button>
              {reasonText ? (
                <button
                  type="button"
                  className="btn disabled:opacity-50"
                  onClick={() => void onRecheck()}
                  disabled={busy}
                  data-testid="onboarding-recheck"
                >
                  {t("onboarding.recheck")}
                </button>
              ) : null}
            </div>
          </form>
          <OnboardingDesks desks={desks} busy={busy} onOpen={(id) => void onOpenDesk(id)} />
        </>
      ) : null}

      {step === "try" ? (
        <section data-testid="onboarding-try">
          <p className="mb-4 text-center text-sm font-medium text-[var(--ok)]" data-testid="onboarding-key-success">
            {t("onboarding.keySuccess")}
          </p>
          <StepHero mode="chat" title={t("onboarding.tryTitle")} body={t("onboarding.tryIntro")} />
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EXAMPLES.map((id, index) => (
              <button
                key={id}
                type="button"
                className="card-live enter-rise group flex items-start gap-3 px-4 py-4 text-left"
                style={{ "--i": index + 4 } as CSSProperties}
                onClick={finish}
                data-testid="onboarding-example"
                data-example={id}
                data-mode={EXAMPLE_MODE[id]}
              >
                <span className="icon-orb icon-orb-solid">
                  <ModeIcon name={EXAMPLE_MODE[id]} size={18} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text)]">
                    {t(`onboarding.examples.${id}.title`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-3)]">
                    {t(`onboarding.examples.${id}.hint`)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <button type="button" className="btn btn-primary" onClick={finish} data-testid="onboarding-start">
              {t("onboarding.tryStart")}
            </button>
          </div>
        </section>
      ) : null}
      </div>
    </main>
  );
}
