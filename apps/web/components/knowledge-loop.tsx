"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { chartPalette } from "@/lib/chart-scale";
import {
  type LoopGraphCounts,
  type LoopSource,
  type LoopStageCount,
  type LoopStageState,
  type LoopVerified,
  barFraction,
  countSourcesByType,
  isWorkSourceType,
  loopStageCounts,
  summarizeLoop,
} from "@/lib/knowledge-loop";

type Props = {
  sources: readonly LoopSource[];
  /** Injected chunks counted by the host. Absent on older hosts; the stage then reads 0. */
  retrievals?: number | null;
  /** Graph size from `GET /api/v1/knowledge`. Absent on older hosts. */
  graph?: LoopGraphCounts;
  /** Last planted-fact self-check. Absent on older hosts; the stage then reads "never". */
  verified?: LoopVerified;
  /** The page's reload path, called after a self-check so every stage refreshes together. */
  onRefresh?: () => void | Promise<void>;
};

const W = 900;
const H = 96;
const STAGE_COUNT = 6;
const NODE_W = 128;
const NODE_H = 40;
const NODE_Y = 26;
const NODE_R = 6;
const GAP = (W - STAGE_COUNT * NODE_W) / (STAGE_COUNT + 1);
const LABEL_FONT = 12;
const VALUE_FONT = 12;
const CAPTION_FONT = 10;
const TEXT_OPACITY = 0.6;
const STROKE_OPACITY = 0.3;
const IDLE_OPACITY = 0.18;
const OK_COLOR = chartPalette(2);
const FAIL_COLOR = chartPalette(1);

function stageX(index: number): number {
  return GAP + index * (NODE_W + GAP);
}

function stageStroke(state: LoopStageState): { stroke: string; opacity: number } {
  if (state === "ok") {
    return { stroke: OK_COLOR, opacity: 1 };
  }
  if (state === "fail") {
    return { stroke: FAIL_COLOR, opacity: 1 };
  }
  return { stroke: "currentColor", opacity: state === "idle" ? IDLE_OPACITY : STROKE_OPACITY };
}

/**
 * The ingest loop, made visible: Work → Saved → Indexed → Graph → Retrieved → Verified → Work,
 * plus a count bar per source type. Source counts come from the list already on the page; the
 * Graph / Retrieved / Verified numbers come from `GET /api/v1/knowledge` and read 0 / never when
 * the host is older than this build.
 */
export function KnowledgeLoop({ sources, retrievals, graph, verified, onRefresh }: Props) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const summary = summarizeLoop(sources);
  const counts = countSourcesByType(sources);
  const stages = loopStageCounts({ sources, retrievals, graph, verified });
  const verifiedStage = stages[stages.length - 1];
  const max = counts.reduce((acc, row) => Math.max(acc, row.total), 0);
  const fill = chartPalette(0);

  async function runSelfCheck() {
    if (checking) {
      return;
    }
    setChecking(true);
    setCheckError(null);
    try {
      const res = await apiFetch("/api/v1/knowledge/verify", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCheckError(data?.error?.message ?? "Could not run the self-check");
        return;
      }
      await onRefresh?.();
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not run the self-check");
    } finally {
      setChecking(false);
    }
  }

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
        aria-label="Work, Saved, Indexed, Graph, Retrieved, Verified, then back to Work"
        data-testid="knowledge-loop-cycle"
      >
        <defs>
          <marker
            id="knowledge-loop-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0.5 L7.5 4 L0 7.5 Z" fill="currentColor" fillOpacity={STROKE_OPACITY} />
          </marker>
        </defs>
        {stages.map((stage, index) => (
          <LoopStageNode
            key={stage.stage}
            stage={stage}
            index={index}
            title={stage.stage === "Verified" && verified?.detail ? verified.detail : undefined}
          />
        ))}
        {/* Return edge: Verified → Work, drawn above the row. */}
        <path
          d={`M ${stageX(STAGE_COUNT - 1) + NODE_W / 2} ${NODE_Y} V 8 H ${stageX(0) + NODE_W / 2} V ${NODE_Y - 3}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity={STROKE_OPACITY}
          strokeWidth={1.5}
          markerEnd="url(#knowledge-loop-arrow)"
        />
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[12px]">
        <span
          className="text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]"
          title={verified?.detail || undefined}
          data-testid="knowledge-loop-verified"
          data-state={verifiedStage?.state ?? "idle"}
        >
          Verified: {verifiedStage?.label ?? "never"} · {verifiedStage?.detail ?? "no self-check yet"}
        </span>
        <button
          type="button"
          className="btn btn-secondary text-[12px]"
          disabled={checking}
          onClick={() => void runSelfCheck()}
          data-testid="knowledge-loop-verify"
        >
          {checking ? "Checking…" : "Run self-check"}
        </button>
      </div>
      {checkError ? (
        <p className="mt-1 text-right text-[12px] text-red-700" data-testid="knowledge-loop-verify-error">
          {checkError}
        </p>
      ) : null}

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
              <span
                className="tabular-nums"
                title={`${row.indexed} indexed, ${row.failed} failed, ${row.chunks} chunks`}
              >
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

function LoopStageNode({ stage, index, title }: { stage: LoopStageCount; index: number; title?: string }) {
  const x = stageX(index);
  const { stroke, opacity } = stageStroke(stage.state);
  const isLast = index === STAGE_COUNT - 1;
  return (
    <g data-testid={`knowledge-loop-stage-${stage.stage}`} data-value={stage.value} data-state={stage.state}>
      <title>
        {title ? `${stage.stage}: ${stage.label} — ${title}` : `${stage.stage}: ${stage.label} · ${stage.detail}`}
      </title>
      <rect
        x={x}
        y={NODE_Y}
        width={NODE_W}
        height={NODE_H}
        rx={NODE_R}
        fill="none"
        stroke={stroke}
        strokeOpacity={opacity}
      />
      <text
        x={x + NODE_W / 2}
        y={NODE_Y + 17}
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: LABEL_FONT, fontWeight: 600 }}
      >
        {stage.stage}
      </text>
      <text
        x={x + NODE_W / 2}
        y={NODE_Y + 32}
        textAnchor="middle"
        fill={stage.state === "ok" || stage.state === "fail" ? stroke : "currentColor"}
        style={{ fontSize: VALUE_FONT, opacity: stage.state === "idle" ? TEXT_OPACITY : 1 }}
      >
        {stage.label}
      </text>
      <text
        x={x + NODE_W / 2}
        y={NODE_Y + NODE_H + 14}
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: CAPTION_FONT, opacity: TEXT_OPACITY }}
      >
        {stage.detail}
      </text>
      {isLast ? null : (
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
      )}
    </g>
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
