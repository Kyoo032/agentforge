"use client";

import { useEffect, useRef, useState } from "react";
import { formatContextLength } from "@agentforge/core/preferred";

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const MUTED = "text-[var(--text-3)]";

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

export function ChatContextChip({ usedTokens, contextLength, parts }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const used = Math.max(0, usedTokens);
  const window_ = contextLength && contextLength > 0 ? contextLength : undefined;
  const left = window_ != null ? Math.max(0, window_ - used) : undefined;
  const fraction = window_ ? Math.min(1, used / window_) : 0;
  const ringLabel = left != null ? `${formatContextLength(left)} left` : `${formatContextLength(used)} used`;
  const title = window_
    ? `About ${used.toLocaleString()} tokens in this chat of ${window_.toLocaleString()} context`
    : `About ${used.toLocaleString()} tokens in this chat`;
  const rows: ContextPart[] =
    parts && parts.length > 0 ? parts : [{ label: "Conversation", detail: "messages in this thread", tokens: used }];

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-auto flex-none">
      {open ? (
        <div
          className="raise absolute right-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-14rem)] rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          data-testid="chat-context-breakdown"
        >
          <div className="mb-3 flex items-baseline gap-2">
            <span className="panel-label">Context window</span>
            <span className="ml-auto text-sm font-medium">
              {window_ != null
                ? `${formatContextLength(used)} / ${formatContextLength(window_)}`
                : `${formatContextLength(used)} used`}
            </span>
          </div>
          <div className="mb-3.5 flex h-2 overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]">
            <span className="h-full bg-accent" style={{ width: `${(window_ ? fraction * 100 : 100).toFixed(1)}%` }} />
          </div>
          <div className="flex flex-col">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 border-b border-[var(--line)] py-1.5 text-xs">
                <span className="h-2 w-2 flex-none rounded-sm bg-accent" aria-hidden="true" />
                <span>{row.label}</span>
                {row.detail ? <span className={`ml-auto ${MUTED}`}>{row.detail}</span> : <span className="ml-auto" />}
                <span className="w-[52px] text-right tabular-nums">{formatContextLength(row.tokens)}</span>
              </div>
            ))}
            <div className={`flex items-center gap-2 py-1.5 text-xs ${MUTED}`}>
              <span className="h-2 w-2 flex-none rounded-sm border border-divider" aria-hidden="true" />
              <span>Free</span>
              <span className="ml-auto w-[52px] text-right tabular-nums">
                {left != null ? formatContextLength(left) : "—"}
              </span>
            </div>
          </div>
          {window_ && fraction >= 0.8 ? (
            <p className="mt-3 text-xs text-[var(--accent)]">Approaching the context limit.</p>
          ) : (
            <p className={`mt-3 text-xs ${MUTED}`}>Estimated at about four characters per token.</p>
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="wash flex items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--surface)] py-1 pl-1.5 pr-2.5 text-xs text-[var(--text-3)] hover:bg-[var(--accent-soft)]"
        data-testid="chat-context"
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" className="flex-none -rotate-90" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke="color-mix(in srgb, var(--color-text) 14%, transparent)"
            strokeWidth="6"
          />
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="6"
            strokeDasharray={`${(fraction * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
          />
        </svg>
        <span className="text-xs text-[var(--text-3)]">{ringLabel}</span>
      </button>
    </div>
  );
}
