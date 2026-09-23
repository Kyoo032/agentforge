"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatContextLength } from "@agentforge/core/preferred";
import { t } from "@/lib/i18n";

const MUTED = "text-[var(--text-3)]";
const PANEL_WIDTH = 320;
const GUTTER = 8;

export type ContextPart = {
  label: string;
  detail?: string;
  tokens: number;
};

type Props = {
  usedTokens: number;
  contextLength?: number;
  parts?: ContextPart[];
};

function paneBounds(trigger: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const pane = trigger.closest("[data-testid='chat-home']");
  const paneRect = pane?.getBoundingClientRect();
  return {
    left: Math.max(GUTTER, paneRect?.left ?? GUTTER),
    right: Math.min(window.innerWidth - GUTTER, paneRect?.right ?? window.innerWidth - GUTTER),
    top: Math.max(GUTTER, paneRect?.top ?? GUTTER),
    bottom: Math.min(window.innerHeight - GUTTER, paneRect?.bottom ?? window.innerHeight - GUTTER),
  };
}

type PanelPos = { top: number; left: number; width: number; maxHeight: number };

function placePanel(trigger: HTMLElement): PanelPos {
  const rect = trigger.getBoundingClientRect();
  const bounds = paneBounds(trigger);
  const width = Math.min(PANEL_WIDTH, Math.max(0, bounds.right - bounds.left));
  let left = rect.right - width;
  left = Math.max(bounds.left, Math.min(left, bounds.right - width));
  const below = rect.bottom + GUTTER;
  const spaceBelow = Math.max(0, bounds.bottom - below);
  const spaceAbove = Math.max(0, rect.top - GUTTER - bounds.top);
  const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
  const top = openBelow ? below : bounds.top;
  const maxHeight = Math.max(120, openBelow ? spaceBelow : spaceAbove);
  return { top, left, width, maxHeight };
}

export function ChatContextChip({ usedTokens, contextLength, parts }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const used = Math.max(0, usedTokens);
  const window_ = contextLength && contextLength > 0 ? contextLength : undefined;
  const left = window_ != null ? Math.max(0, window_ - used) : undefined;
  const fraction = window_ ? Math.min(1, used / window_) : 0;
  const ringLabel =
    window_ != null
      ? t("chat.context.meter", { used: formatContextLength(used), window: formatContextLength(window_) })
      : t("chat.context.usedMeter", { used: formatContextLength(used) });
  const title = window_
    ? t("chat.context.titleWithWindow", { used: used.toLocaleString(), window: window_.toLocaleString() })
    : t("chat.context.title", { used: used.toLocaleString() });
  const rows: ContextPart[] =
    parts && parts.length > 0
      ? parts
      : [{ label: t("chat.context.conversation"), detail: t("chat.context.conversationDetail"), tokens: used }];

  useEffect(() => {
    if (!open) {
      return;
    }
    function place() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }
      setPos(placePanel(trigger));
    }
    place();
    const frame = window.requestAnimationFrame(place);
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, rows.length]);

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="raise fixed z-[80] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            data-testid="chat-context-breakdown"
            role="dialog"
            aria-label={t("chat.context.window")}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            <div className="mb-3 flex items-baseline gap-3">
              <span className="panel-label">{t("chat.context.window")}</span>
              <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                {window_ != null
                  ? `${formatContextLength(used)} / ${formatContextLength(window_)}`
                  : t("chat.context.used", { n: formatContextLength(used) })}
              </span>
            </div>
            <div className="mb-3.5 flex h-2 overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]">
              <span className="h-full bg-accent" style={{ width: `${(window_ ? fraction * 100 : 100).toFixed(1)}%` }} />
            </div>
            <div className="flex flex-col">
              {rows.map((row) => (
                <div key={row.label} className="flex items-start gap-2 border-b border-[var(--line)] py-1.5 text-xs">
                  <span className="mt-1 h-2 w-2 flex-none rounded-sm bg-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[var(--text)]">{row.label}</span>
                    {row.detail ? <span className={`block ${MUTED}`}>{row.detail}</span> : null}
                  </span>
                  <span className="w-[52px] shrink-0 pt-px text-right tabular-nums">{formatContextLength(row.tokens)}</span>
                </div>
              ))}
              <div className={`flex items-start gap-2 py-1.5 text-xs ${MUTED}`}>
                <span className="mt-1 h-2 w-2 flex-none rounded-sm border border-divider" aria-hidden="true" />
                <span className="min-w-0 flex-1">{t("chat.context.free")}</span>
                <span className="w-[52px] shrink-0 text-right tabular-nums">
                  {left != null ? formatContextLength(left) : "—"}
                </span>
              </div>
            </div>
            {window_ && fraction >= 0.8 ? (
              <p className="mt-3 text-xs text-[var(--accent)]">{t("chat.context.approaching")}</p>
            ) : (
              <p className={`mt-3 text-xs ${MUTED}`}>{t("chat.context.estimate")}</p>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative ml-auto flex-none">
      <button
        ref={triggerRef}
        type="button"
        className="wash flex items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--surface)] py-1 pl-1.5 pr-2.5 text-xs text-[var(--text-3)] hover:bg-[var(--accent-soft)]"
        data-testid="chat-context"
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const trigger = triggerRef.current;
          if (trigger) {
            setPos(placePanel(trigger));
          }
          setOpen(true);
        }}
      >
        <span className="text-xs text-[var(--text)]">{ringLabel}</span>
      </button>
      {panel}
    </div>
  );
}
