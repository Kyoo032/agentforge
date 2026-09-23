"use client";

import { useEffect, useRef, useState } from "react";
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
};

export function EnhancePromptButton({
  text,
  surface,
  model,
  disabled,
  testId = "composer-enhance",
  onApply,
  onBusyChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
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
      const data = (await res.json().catch(() => null)) as { text?: unknown; error?: { message?: string } } | null;
      if (abort.signal.aborted) {
        return;
      }
      if (!res.ok || !data || typeof data.text !== "string") {
        throw new Error(data?.error?.message ?? t("chat.enhance.failed"));
      }
      originalRef.current = text;
      appliedRef.current = data.text;
      onApply(data.text);
      setEnhanced(true);
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
      }
      setBusyState(false);
    }
  }

  const empty = !enhanced && !text.trim();
  return (
    <button
      type="button"
      className="wash inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-transparent px-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-45"
      data-tip={busy ? t("chat.enhance.busy") : enhanced ? t("chat.enhance.revert") : t("chat.enhance.idle")}
      aria-label={busy ? t("chat.enhance.busy") : enhanced ? t("chat.enhance.revert") : t("chat.enhance.idle")}
      aria-pressed={enhanced}
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
      <span>{busy ? t("chat.enhance.busy") : enhanced ? t("chat.enhance.revert") : t("chat.enhance.idle")}</span>
    </button>
  );
}
