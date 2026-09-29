"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatContextLength } from "@agentforge/core/preferred";
import { useChatHeaderLayout } from "@/components/chat-header-layout";
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
  const [pos, setPos] = useState<PanelPos | null>(null);
  // In the header's "Chat details" menu the breakdown unfolds inside this chip's own row instead of
  // opening a popover: a popover opened from inside a menu would nest one focus trap in another.
  const layout = useChatHeaderLayout();
  const inMenu = layout.presentation === "menu";
  const menuOpen = layout.menuOpen;
  // The details are open for the header layout they were opened in only. The header changing how it
  // presents its chips, or its menu opening or shutting, starts them closed again with no effect to
  // run, so they are never left open in the row of a shut menu, or when it is next opened.
  const [openEpoch, setOpenKey] = useState<number | null>(null);
  const open = openEpoch === layout.epoch;
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
    if (!open || inMenu) {
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
      setOpenKey(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenKey(null);
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
  }, [open, inMenu, rows.length]);

  // The same breakdown in both places it can appear: the popover beside the bar, or a row of the menu.
  const breakdown = (
    <>
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
    </>
  );

  const panel =
    open && !inMenu && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[80] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-elev-2"
            data-testid="chat-context-breakdown"
            role="dialog"
            aria-label={t("chat.context.window")}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            {breakdown}
          </div>,
          document.body,
        )
      : null;

  const rowDetail =
    open && inMenu && menuOpen ? (
      <div
        className="chat-header-detail"
        data-testid="chat-context-breakdown"
        role="group"
        aria-label={t("chat.context.window")}
      >
        {breakdown}
      </div>
    ) : null;

  return (
    <div className="relative min-w-0 max-w-full">
      <button
        ref={triggerRef}
        type="button"
        className="chip wash max-w-full whitespace-nowrap"
        data-testid="chat-context"
        title={title}
        aria-expanded={open}
        aria-haspopup={inMenu ? undefined : "dialog"}
        onClick={() => {
          if (open) {
            setOpenKey(null);
            return;
          }
          const trigger = triggerRef.current;
          if (trigger && !inMenu) {
            setPos(placePanel(trigger));
          }
          setOpenKey(layout.epoch);
        }}
      >
        <span className="min-w-0 truncate text-xs text-[var(--text)]">{ringLabel}</span>
      </button>
      {panel}
      {rowDetail}
    </div>
  );
}
