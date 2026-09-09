"use client";

import { chartPalette } from "@/lib/chart-scale";
import {
  LOOP_STAGES,
  barFraction,
  countSourcesByType,
  isWorkSourceType,
  summarizeLoop,
  type LoopSource,
} from "@/lib/knowledge-loop";

type Props = { sources: readonly LoopSource[] };

const W = 640;
const H = 96;
const NODE_W = 118;
const NODE_H = 34;
const NODE_Y = 22;
const NODE_R = 6;
const GAP = (W - 4 * NODE_W) / 5;
const LABEL_FONT = 12;
const CAPTION_FONT = 10;
const TEXT_OPACITY = 0.6;
const STROKE_OPACITY = 0.3;

const STAGE_CAPTION: Record<(typeof LOOP_STAGES)[number], string> = {
  Work: "Chat or a job mode",
  Saved: "media / artifacts",
  Indexed: "text card in KB",
  Retrieved: "next Chat or job",
};

/**
 * The ingest loop, made visible: Work → Saved → Indexed → Retrieved → Work, plus a count bar
 * per source type. Counts come from the Sources list already on the page (no extra fetch).
 */
export function KnowledgeLoop({ sources }: Props) {
  const summary = summarizeLoop(sources);
  const counts = countSourcesByType(sources);
  const max = counts.reduce((acc, row) => Math.max(acc, row.total), 0);
  const fill = chartPalette(0);
  return (
    <section className="blueprint p-[18px]" data-testid="knowledge-loop" aria-label="Knowledge loop">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="panel-label">Loop</p>
        <p className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
          Every finished piece of work becomes a text card here. Files stay in their gallery.
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label="Work, then Saved, then Indexed, then Retrieved, then back to Work"
        data-testid="knowledge-loop-cycle"
      >
        <defs>
          <marker id="knowledge-loop-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0.5 L7.5 4 L0 7.5 Z" fill="currentColor" fillOpacity={STROKE_OPACITY} />
          </marker>
        </defs>
        {LOOP_STAGES.map((stage, index) => {
          const x = GAP + index * (NODE_W + GAP);
          const next = index < LOOP_STAGES.length - 1;
          return (
            <g key={stage}>
              <rect
                x={x}
                y={NODE_Y}
                width={NODE_W}
                height={NODE_H}
                rx={NODE_R}
                fill="none"
                stroke="currentColor"
                strokeOpacity={STROKE_OPACITY}
              />
              <text
                x={x + NODE_W / 2}
                y={NODE_Y + NODE_H / 2 + 4}
                textAnchor="middle"
                fill="currentColor"
                style={{ fontSize: LABEL_FONT, fontWeight: 600 }}
              >
                {stage}
              </text>
              <text
                x={x + NODE_W / 2}
                y={NODE_Y + NODE_H + 16}
                textAnchor="middle"
                fill="currentColor"
                style={{ fontSize: CAPTION_FONT, opacity: TEXT_OPACITY }}
              >
                {STAGE_CAPTION[stage]}
              </text>
              {next ? (
                <line
                  x1={x + NODE_W + 3}
                  x2={x + NODE_W + GAP - 3}
                  y1={NODE_Y + NODE_H / 2}
                  y2={NODE_Y + NODE_H / 2}
                  stroke="currentColor"
                  strokeOpacity={STROKE_OPACITY}
                  strokeWidth={1.5}
                  markerEnd="url(#knowledge-loop-arrow)"
                />
              ) : null}
            </g>
          );
        })}
        {/* Return edge: Retrieved → Work, drawn above the row. */}
        <path
          d={`M ${GAP + 3 * (NODE_W + GAP) + NODE_W / 2} ${NODE_Y} V 8 H ${GAP + NODE_W / 2} V ${NODE_Y - 3}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity={STROKE_OPACITY}
          strokeWidth={1.5}
          markerEnd="url(#knowledge-loop-arrow)"
        />
      </svg>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]" data-testid="knowledge-loop-summary">
        <Stat label="From work" value={summary.work} testId="knowledge-loop-work" />
        <Stat label="Added by hand" value={summary.manual} testId="knowledge-loop-manual" />
        <Stat label="Indexed" value={summary.indexed} testId="knowledge-loop-indexed" />
        <Stat label="Failed" value={summary.failed} testId="knowledge-loop-failed" />
        <Stat label="Chunks" value={summary.chunks} testId="knowledge-loop-chunks" />
      </dl>

      {counts.length === 0 ? (
        <p
          className="mt-3 text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]"
          data-testid="knowledge-loop-empty"
        >
          Nothing indexed yet. Send a Chat message or run a job mode and a card appears here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5" data-testid="knowledge-loop-counts" aria-label="Sources by type">
          {counts.map((row) => (
            <li
              key={row.type}
              className="grid grid-cols-[104px_1fr_auto] items-center gap-3 text-[12px]"
              data-testid={`knowledge-loop-count-${row.type}`}
              data-count={row.total}
            >
              <span className="flex items-center gap-1.5 truncate" title={row.type}>
                <span className="truncate">{row.type}</span>
                {isWorkSourceType(row.type) ? (
                  <span className="text-[10px] uppercase tracking-wide opacity-60" aria-label="written by the loop">
                    auto
                  </span>
                ) : null}
              </span>
              <span className="relative h-2.5 overflow-hidden rounded-[4px] bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)]">
                <span
                  className="absolute inset-y-0 left-0 rounded-[4px]"
                  style={{ width: `${Math.round(barFraction(row.total, max) * 100)}%`, backgroundColor: fill }}
                  aria-hidden
                />
              </span>
              <span className="tabular-nums" title={`${row.indexed} indexed, ${row.failed} failed, ${row.chunks} chunks`}>
                {row.total}
                {row.failed > 0 ? <span className="ml-1 opacity-60">({row.failed} failed)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="flex items-baseline gap-1.5" data-testid={testId} data-value={value}>
      <dt className="text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
