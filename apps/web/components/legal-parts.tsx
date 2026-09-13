"use client";

import type { ReactNode } from "react";
import type { Tone } from "@/lib/legal-view";

type PanelProps = { label: string; aside?: ReactNode; children: ReactNode; testId?: string; className?: string };

export function LegalPanel({ label, aside, children, testId, className = "" }: PanelProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 ${className}`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <div className="panel-label">{label}</div>
        {aside ? <span className="ml-auto text-xs text-[var(--text-3)]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  red: "tag border-[var(--danger)] text-[var(--danger)]",
  amber: "tag border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
  green: "tag border-[var(--ok)] text-[var(--ok)]",
  neutral: "tag border-[var(--line)] text-[var(--text-2)]",
};

export function ToneTag({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={TONE_CLASS[tone]} data-testid={testId}>
      {children}
    </span>
  );
}

export const TH = "px-2 py-1.5 text-left panel-label whitespace-nowrap";
export const TD = "border-t border-[var(--line)] px-2 py-2 align-top text-sm text-[var(--text)]";
export const DIM = "text-[var(--text-2)]";
