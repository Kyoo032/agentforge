import { useState } from "react";
import { fetchEditDoctor, type EditDoctor, type FfmpegSetup } from "@/lib/edit-client";

type Props = {
  doctor: EditDoctor;
  onDoctor: (doctor: EditDoctor) => void;
  /** Compact renders a single banner line; full renders the step list (onboarding). */
  variant?: "compact" | "full";
};

const PLATFORM_LABEL: Record<FfmpegSetup["platform"], string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guides the owner through installing ffmpeg for their OS and re-probes without a restart.
 * Renders nothing when ffmpeg is already usable.
 */
export function FfmpegSetupNotice({ doctor, onDoctor, variant = "compact" }: Props) {
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const ffmpeg = doctor.ffmpeg;
  if (!ffmpeg || ffmpeg.found !== false) {
    return null;
  }
  const setup = ffmpeg.setup;
  const command = setup?.installCommand ?? "install ffmpeg 6 or newer";
  const summary = setup?.summary ?? "ffmpeg was not found. Probe, cut, captions and export need it.";

  async function recheck() {
    setChecking(true);
    setCheckError(null);
    const next = await fetchEditDoctor({ recheck: true });
    setChecking(false);
    if (!next) {
      setCheckError("Could not reach the local host to re-check. Try again in a moment.");
      return;
    }
    onDoctor(next);
  }

  async function copy() {
    const ok = await copyText(command);
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className="border-b border-divider bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-4 py-2 text-xs text-ink/80"
      data-testid="edit-needs-ffmpeg"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <strong>{setup ? `${PLATFORM_LABEL[setup.platform]} setup:` : "Setup:"}</strong> {summary}
        </span>
        <code className="rounded bg-paper px-2 py-0.5 font-mono text-[12px]" data-testid="ffmpeg-install-command">
          {command}
        </code>
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[12px]" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="btn btn-secondary px-2 py-0.5 text-[12px]"
          onClick={() => void recheck()}
          disabled={checking}
          data-testid="ffmpeg-recheck"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
        {setup?.installUrl ? (
          <a className="underline" href={setup.installUrl} target="_blank" rel="noreferrer">
            Install guide
          </a>
        ) : null}
      </div>
      {checkError ? <p className="mt-1 text-red-700">{checkError}</p> : null}
      {variant === "full" && setup ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5" data-testid="ffmpeg-setup-steps">
          {setup.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
