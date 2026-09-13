"use client";

import type { ReactNode } from "react";
import type { Tone } from "@/lib/legal-view";

/** Quiet card wrapper (corner marks retired). */
export function Corners() {
  return null;
}

type PanelProps = { label: string; aside?: ReactNode; children: ReactNode; testId?: string; className?: string };

export function LegalPanel({ label, aside, children, testId, className = "" }: PanelProps) {
  return (
    <section className={`blueprint p-4 ${className}`} data-testid={testId}>
      <Corners />
      <div className="flex items-center gap-2">
        <div className="panel-label">{label}</div>
        {aside ? <span className="ml-auto text-[12px] text-[var(--text-3)]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  red: "tag border-red-300 bg-red-50 text-red-800",
  amber: "tag border-amber-300 bg-amber-50 text-amber-800",
  green: "tag border-emerald-300 bg-emerald-50 text-emerald-800",
  neutral: "tag tag-neutral",
};

export function ToneTag({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={TONE_CLASS[tone]} data-testid={testId}>
      {children}
    </span>
  );
}

export const TH = "px-2 py-1.5 text-left panel-label whitespace-nowrap";
export const TD = "px-2 py-2 align-top text-[13px] border-t border-divider";
export const DIM = "text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]";
