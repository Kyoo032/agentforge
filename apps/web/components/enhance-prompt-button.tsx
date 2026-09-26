"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EnhanceSurface } from "@agentforge/core";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";

type Props = {
  text: string;
  surface: EnhanceSurface;
  model?: string;
  disabled?: boolean;
  testId?: string;
  onApply: (next: string) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Chat's toolbar is a row of pills. Other desks keep the tighter control. */
  pill?: boolean;
};

/** The sentence for a failed enhance: the host's reason when it gave one, otherwise the catalog's. */
export function enhanceFailureMessage(data: unknown): string {
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  const reason = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return typeof reason === "string" && reason.trim()
    ? t("common.enhance.failedReason", { reason: reason.trim() })
    : t("common.enhance.failed");
}

export function EnhancePromptButton({
  text,
  surface,
  model,
  disabled,
  testId = "composer-enhance",
  onApply,
  onBusyChange,
  pill = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  /** The last failed enhance and the prompt it was for. Editing the prompt retires it. */
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
  const errorId = useId();
  const originalRef = useRef<string | null>(null);
  const appliedRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (enhanced && appliedRef.current !== null && text !== appliedRef.current) {
      originalRef.current = null;
      appliedRef.current = null;
      setEnhanced(false);
    }
  }, [text, enhanced]);

  function setBusyState(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }

  async function onClick() {
    if (disabled) {
      return;
    }
    if (busy) {
      abortRef.current?.abort();
      return;
    }
    if (enhanced && originalRef.current !== null) {
      onApply(originalRef.current);
      originalRef.current = null;
      appliedRef.current = null;
      setEnhanced(false);
      return;
    }
    const seed = text.trim();
    if (!seed) {
      return;
    }
    setFailure(null);
    const abort = new AbortController();
    abortRef.current = abort;
    setBusyState(true);
    try {
      const res = await apiFetch("/api/v1/prompts/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: seed, surface, model: model || undefined }),
        signal: abort.signal,
      });
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      if (abort.signal.aborted) {
        return;
      }
      if (!res.ok || !data || typeof data.text !== "string") {
        // The prompt is left as it was; say so instead of looking as if nothing was pressed.
        setFailure({ text, message: enhanceFailureMessage(data) });
        return;
      }
      originalRef.current = text;
      appliedRef.current = data.text;
      onApply(data.text);
      setEnhanced(true);
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      setFailure({ text, message: t("common.enhance.failed") });
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
      }
      setBusyState(false);
    }
  }

  const empty = !enhanced && !text.trim();
  const actionLabel = busy ? t("chat.enhance.busy") : enhanced ? t("chat.enhance.revert") : t("chat.enhance.idle");
  const error = failure !== null && failure.text === text && !busy ? failure.message : null;
  const failed = error !== null;
  return (
    <>
      <button
        type="button"
        className={`wash inline-flex h-8 shrink-0 items-center gap-1.5 border bg-transparent px-3 text-xs font-medium hover:bg-[var(--surface-2)] disabled:opacity-45 ${pill ? "rounded-pill" : "rounded-lg"} ${
          failed ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--line)] text-[var(--text)]"
        }`}
        data-tip={failed ? error : actionLabel}
        aria-label={actionLabel}
        aria-describedby={failed ? errorId : undefined}
        aria-pressed={enhanced}
        data-state={failed ? "error" : undefined}
        data-testid={enhanced ? `${testId}-revert` : testId}
        disabled={disabled || empty}
        onClick={() => void onClick()}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 15.9l-1.7-4.5L5.8 9.7 10.3 8 12 3.5Z" />
          <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
        </svg>
        <span>{failed ? t("common.enhance.failedShort") : actionLabel}</span>
      </button>
      {/* Mounted from the first render so the reason is announced when it appears. Visually hidden:
          the button's own error state and its tip carry it on screen, and the toolbars it sits in
          clip anything drawn outside them. */}
      <span id={errorId} className="sr-only" role="alert" data-testid={`${testId}-error`}>
        {failed ? error : ""}
      </span>
    </>
  );
}
