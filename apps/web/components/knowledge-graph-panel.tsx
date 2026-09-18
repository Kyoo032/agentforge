"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import {
  GRAPH_DRAW_LIMIT,
  GRAPH_EDGE_COLOR,
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  GRAPH_NODE_LIMIT,
  type KnowledgeGraph,
  capGraph,
  edgeStrokeWidth,
  egoSubgraph,
  layoutGraph,
  nodeKindColor,
  normalizeGraph,
} from "@/lib/knowledge-graph";
import type { LoopGraphCounts } from "@/lib/knowledge-loop";

type Props = {
  /** Node / edge totals from `GET /api/v1/knowledge`. Absent on hosts older than this build. */
  counts?: LoopGraphCounts;
};

type Status = "idle" | "loading" | "ready" | "error";

const MUTED = "text-[var(--text-2)]";
const FAINT = "text-[var(--text-3)]";
const NODE_R = 5;
const FOCUS_R = 8;
const LABEL_FONT = 12;
const LABEL_OPACITY = 0.78;
const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [] };

/**
 * Topic ↔ source ↔ thread links, collapsed by default under the health strip. Opening it fetches
 * `GET /api/v1/knowledge/graph?limit=200`; a host without that route just shows the error line.
 * Layout is a deterministic three-column SVG — no physics, no chart lib — and only the first
 * `GRAPH_DRAW_LIMIT` nodes are drawn until the reader asks for the rest.
 */
export function KnowledgeGraphPanel({ counts }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY_GRAPH);
  const [focus, setFocus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Do not gate on status === "idle": React Strict Mode remounts this effect after the first
    // fetch is cancelled, and a leftover "loading" state would never start a second request.
    let cancelled = false;
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/v1/knowledge/graph?limit=${GRAPH_NODE_LIMIT}`);
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setError(data?.error?.message ?? t("knowledge.errors.loadGraph"));
          setStatus("error");
          return;
        }
        setGraph(normalizeGraph(data));
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("knowledge.errors.loadGraph"));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  const full = capGraph(graph, GRAPH_NODE_LIMIT);
  const scoped = focus ? egoSubgraph(full, focus) : full;
  const shown = capGraph(scoped, expanded ? GRAPH_NODE_LIMIT : GRAPH_DRAW_LIMIT);
  const layout = layoutGraph(shown);
  const hasMore = scoped.nodes.length > shown.nodes.length;
  const totalNodes = Math.max(counts?.nodes ?? 0, graph.nodes.length);
  const totalEdges = Math.max(counts?.edges ?? 0, graph.edges.length);
  const focusLabel = focus ? (full.nodes.find((node) => node.id === focus)?.label ?? focus) : null;
  const drawn = status === "ready" && full.nodes.length > 0;

  return (
    <section
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="knowledge-graph-panel"
      aria-label={t("knowledge.graph.aria")}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="panel-label">{t("knowledge.graph.label")}</p>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="knowledge-graph-toggle"
        >
          {open ? t("knowledge.graph.hide") : t("knowledge.graph.show")}
          <span
            className={FAINT}
            data-testid="knowledge-graph-counts"
            data-nodes={totalNodes}
            data-edges={totalEdges}
          >
            {`· ${t("knowledge.graph.counts", { nodes: totalNodes, edges: totalEdges })}`}
          </span>
        </button>
        {open && drawn ? (
          <span
            className={`text-xs ${FAINT}`}
            data-testid="knowledge-graph-shown"
            data-shown={layout.nodes.length}
            data-total={totalNodes}
          >
            {/* Silent when the drawing already is the whole graph — the header states that. */}
            {focusLabel
              ? t("knowledge.graph.around", { label: focusLabel })
              : hasMore
                ? t("knowledge.graph.drawn", { shown: layout.nodes.length })
                : ""}
          </span>
        ) : null}
        {open && hasMore ? (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => setExpanded(true)}
            data-testid="knowledge-graph-show-all-nodes"
          >
            {t("knowledge.graph.showAllNodes", { total: scoped.nodes.length })}
          </button>
        ) : null}
        {focus ? (
          <button
            type="button"
            className="btn btn-ghost ml-auto text-xs"
            onClick={() => setFocus(null)}
            data-testid="knowledge-graph-clear-focus"
          >
            {t("knowledge.graph.showAll")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3">
          {status === "loading" ? (
            <p className={`text-xs ${MUTED}`} data-testid="knowledge-graph-loading">
              {t("knowledge.graph.loading")}
            </p>
          ) : null}
          {status === "error" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-[var(--danger)]" data-testid="knowledge-graph-error">
                {error ?? t("knowledge.errors.loadGraph")}
              </p>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => setReload((n) => n + 1)}
                data-testid="knowledge-graph-retry"
              >
                {t("knowledge.graph.retry")}
              </button>
            </div>
          ) : null}
          {status === "ready" && full.nodes.length === 0 ? (
            <p className={`text-xs ${MUTED}`} data-testid="knowledge-graph-empty">
              {t("knowledge.graph.empty")}
            </p>
          ) : null}
          {drawn ? (
            <>
              <ul
                className={`flex flex-wrap gap-1.5 text-xs ${FAINT}`}
                data-testid="knowledge-graph-legend"
              >
                {GRAPH_NODE_KINDS.map((kind) => (
                  <li
                    key={kind}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-0.5"
                    title={t(`knowledge.graph.nodeHint.${kind}`)}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeKindColor(kind) }}
                      aria-hidden
                    />
                    {t(`knowledge.graph.node.${kind}`)}
                  </li>
                ))}
                {GRAPH_EDGE_KINDS.map((kind) => (
                  <li
                    key={kind}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-0.5"
                    title={t(`knowledge.graph.edgeHint.${kind}`)}
                  >
                    <span
                      className="inline-block h-px w-4 shrink-0"
                      style={{ backgroundColor: GRAPH_EDGE_COLOR }}
                      aria-hidden
                    />
                    {t(`knowledge.graph.edge.${kind}`)}
                  </li>
                ))}
              </ul>
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="mt-3 h-auto w-full"
                role="img"
                aria-label={t("knowledge.graph.svgAria")}
                data-testid="knowledge-graph-svg"
              >
                {layout.edges.map((edge) => (
                  <line
                    key={`${edge.from}-${edge.to}-${edge.kind}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={GRAPH_EDGE_COLOR}
                    strokeWidth={edgeStrokeWidth(edge.weight)}
                  >
                    <title>
                      {t("knowledge.graph.edgeTitle", {
                        kind: t(`knowledge.graph.edge.${edge.kind}`),
                        weight: edge.weight,
                      })}
                    </title>
                  </line>
                ))}
                {layout.nodes.map((node) => (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    onClick={() => setFocus(focus === node.id ? null : node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setFocus(focus === node.id ? null : node.id);
                      }
                    }}
                    data-testid={`knowledge-graph-node-${node.id}`}
                    data-kind={node.kind}
                  >
                    <title>{`${node.label} (${t(`knowledge.graph.node.${node.kind}`)})`}</title>
                    {focus === node.id ? (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={FOCUS_R}
                        fill="none"
                        stroke={nodeKindColor(node.kind)}
                        strokeWidth={1.5}
                      />
                    ) : null}
                    <circle cx={node.x} cy={node.y} r={NODE_R} fill={nodeKindColor(node.kind)} />
                    <text
                      x={node.labelX}
                      y={node.labelY}
                      textAnchor={node.labelAnchor}
                      fill="currentColor"
                      style={{ fontSize: LABEL_FONT, opacity: LABEL_OPACITY }}
                    >
                      {node.labelText}
                    </text>
                  </g>
                ))}
              </svg>
              <p className={`mt-1 text-xs ${FAINT}`}>{t("knowledge.graph.hint")}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
