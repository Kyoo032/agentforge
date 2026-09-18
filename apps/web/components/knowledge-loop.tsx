"use client";

import { Fragment, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import {
  type HealthTile,
  type VerifiedTone,
  healthTiles,
  shouldShowByType,
  verifiedTone,
} from "@/lib/knowledge-health";
import {
  type LoopGraphCounts,
  type LoopSource,
  type LoopVerified,
  countSourcesByType,
  loopStageCounts,
} from "@/lib/knowledge-loop";

function formatVerifiedCopy(verified: LoopVerified, now = Date.now()): string {
  if (!verified || typeof verified !== "object") {
    return t("knowledge.loop.verified.none");
  }
  const at = verified.at;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
    return t("knowledge.loop.verified.unknown");
  }
  const elapsed = now - at;
  if (elapsed < 45_000) {
    return t("knowledge.loop.verified.justNow");
  }
  if (elapsed < 3_600_000) {
    return t("knowledge.loop.verified.minutesAgo", { count: Math.floor(elapsed / 60_000) });
  }
  if (elapsed < 86_400_000) {
    return t("knowledge.loop.verified.hoursAgo", { count: Math.floor(elapsed / 3_600_000) });
  }
  return t("knowledge.loop.verified.daysAgo", { count: Math.floor(elapsed / 86_400_000) });
}

type Props = {
  sources: readonly LoopSource[];
  /** Injected chunks counted by the host. Absent on older hosts; the tile then reads 0. */
  retrievals?: number | null;
  /** Graph size from `GET /api/v1/knowledge`. Absent on older hosts. */
  graph?: LoopGraphCounts;
  /** Last planted-fact self-check. Absent on older hosts; the pill then reads "never". */
  verified?: LoopVerified;
  /** The page's reload path, called after a self-check so every tile refreshes together. */
  onRefresh?: () => void | Promise<void>;
};

/** No amber token exists in the quiet-tool palette, so stale / never warms the muted ink. */
const TONE_COLOR: Record<VerifiedTone, string> = {
  pass: "var(--ok)",
  fail: "var(--danger)",
  stale: "color-mix(in srgb, var(--danger) 45%, var(--text-3))",
  never: "color-mix(in srgb, var(--danger) 45%, var(--text-3))",
};

const TILE_LABEL: Record<HealthTile["key"], string> = {
  work: "knowledge.loop.workCards",
  manual: "knowledge.loop.addedByHand",
  indexed: "knowledge.loop.indexed",
  retrieved: "knowledge.loop.retrieved",
  failed: "knowledge.loop.failed",
};

/** Sub-line under each tile. The Saved total and the chunk count live here. */
function tileSub(tile: HealthTile): string {
  if (tile.key === "manual") {
    return t("knowledge.loop.sub.saved", { count: tile.sub });
  }
  if (tile.key === "indexed") {
    return t(tile.sub === 1 ? "knowledge.loop.sub.chunksOne" : "knowledge.loop.sub.chunks", { count: tile.sub });
  }
  if (tile.key === "retrieved") {
    return t("knowledge.loop.sub.retrieved");
  }
  if (tile.key === "failed") {
    return t("knowledge.loop.sub.failed");
  }
  return t("knowledge.loop.sub.work");
}

/**
 * Knowledge health: four stat tiles (work cards, added by hand, indexed, retrieved), a Verified
 * pill with the self-check button, and — only when there is a mix — one muted by-type line.
 * This replaced the six-box pipeline drawing; the stage testids ride on the tiles they became,
 * and the graph size moved to the map panel header.
 */
export function KnowledgeLoop({ sources, retrievals, graph, verified, onRefresh }: Props) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const counts = countSourcesByType(sources);
  const tiles = healthTiles({ sources, retrievals, graph, verified });
  const stages = loopStageCounts({ sources, retrievals, graph, verified });
  const verifiedStage = stages[stages.length - 1];
  const tone = verifiedTone(verified);

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
        setCheckError(data?.error?.message ?? t("knowledge.errors.selfCheck"));
        return;
      }
      await onRefresh?.();
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : t("knowledge.errors.selfCheck"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="knowledge-loop"
      aria-label={t("knowledge.loop.aria")}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="panel-label">{t("knowledge.loop.label")}</p>
        <p className="text-xs text-[var(--text-2)]">{t("knowledge.loop.intro")}</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-1 text-xs"
            data-testid={`knowledge-loop-stage-${verifiedStage?.stage ?? "Verified"}`}
            data-value={verifiedStage?.value ?? 0}
            data-state={verifiedStage?.state ?? "idle"}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: TONE_COLOR[tone] }}
              aria-hidden
            />
            <span
              className="text-[var(--text-2)]"
              title={verified?.detail || undefined}
              data-testid="knowledge-loop-verified"
              data-state={verifiedStage?.state ?? "idle"}
              data-tone={tone}
            >
              {t("knowledge.loop.verifiedLine", {
                label: verifiedStage
                  ? labeled(`knowledge.loop.verified.${verifiedStage.label}`, verifiedStage.label)
                  : t("knowledge.loop.verified.never"),
                detail: formatVerifiedCopy(verified),
              })}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={checking}
            onClick={() => void runSelfCheck()}
            data-testid="knowledge-loop-verify"
          >
            {checking ? t("knowledge.loop.checking") : t("knowledge.loop.runCheck")}
          </button>
        </div>
      </div>

      {checkError ? (
        <p className="mt-2 text-xs text-[var(--danger)]" data-testid="knowledge-loop-verify-error">
          {checkError}
        </p>
      ) : null}

      <dl
        className="mt-3 flex flex-wrap gap-2"
        data-testid="knowledge-loop-summary"
        aria-label={t("knowledge.loop.tilesAria")}
      >
        {tiles.map((tile) => (
          <StatTile key={tile.key} tile={tile} />
        ))}
      </dl>

      {counts.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-2)]" data-testid="knowledge-loop-empty">
          {t("knowledge.loop.empty")}
        </p>
      ) : null}

      {shouldShowByType(counts) ? (
        <p
          className="mt-2 text-xs text-[var(--text-3)]"
          data-testid="knowledge-loop-counts"
          aria-label={t("knowledge.loop.byTypeAria")}
        >
          {`${t("knowledge.loop.byType")}: `}
          {counts.map((row, index) => (
            <Fragment key={row.type}>
              {index > 0 ? <span aria-hidden> · </span> : null}
              <span
                data-testid={`knowledge-loop-count-${row.type}`}
                data-count={row.total}
                title={t("knowledge.loop.countTitle", {
                  indexed: row.indexed,
                  failed: row.failed,
                  chunks: row.chunks,
                })}
              >
                {`${labeled(`knowledge.sourceType.${row.type}`, row.type)} `}
                <span className="tabular-nums text-[var(--text-2)]">{row.total}</span>
              </span>
            </Fragment>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One compact tile. The root carries the loop stage it replaced (testid, `data-value`,
 * `data-state`); the number carries the summary testid the old counters row used.
 */
function StatTile({ tile }: { tile: HealthTile }) {
  return (
    <div
      className="min-w-[148px] flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2"
      data-testid={tile.stage ? `knowledge-loop-stage-${tile.stage}` : undefined}
      data-value={tile.stageValue}
      data-state={tile.stageState}
    >
      <dt className="text-xs text-[var(--text-2)]">{t(TILE_LABEL[tile.key])}</dt>
      <dd
        className="mt-0.5 text-[20px] font-medium leading-tight tabular-nums"
        style={tile.danger ? { color: "var(--danger)" } : undefined}
        data-testid={`knowledge-loop-${tile.key}`}
        data-value={tile.value}
      >
        {tile.value}
      </dd>
      <p
        className="text-xs text-[var(--text-3)]"
        data-testid={tile.key === "indexed" ? "knowledge-loop-chunks" : undefined}
        data-value={tile.key === "indexed" ? tile.sub : undefined}
      >
        {tileSub(tile)}
      </p>
    </div>
  );
}
