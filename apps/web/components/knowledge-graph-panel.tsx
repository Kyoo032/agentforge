"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { truncateLabel } from "@/lib/chart-scale";
import {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  GRAPH_NODE_LIMIT,
  type GraphLayoutNode,
  type GraphNodeKind,
  type KnowledgeGraph,
  capGraph,
  edgeKindColor,
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

const MUTED = "text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]";
const NODE_R = 5;
const FOCUS_R = 8;
const LABEL_FONT = 10;
const LABEL_PAD = 10;
const EDGE_OPACITY = 0.45;
const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [] };

const EDGE_KIND_HINT: Record<(typeof GRAPH_EDGE_KINDS)[number], string> = {
  covers: "topic covers a source",
  retrieved: "source was retrieved by a thread",
  cites: "thread cited a source",
};

const NODE_KIND_HINT: Record<GraphNodeKind, string> = {
  topic: "map topics",
  source: "indexed sources",
  thread: "chat threads",
};

function labelAnchor(kind: GraphNodeKind): "start" | "middle" | "end" {
  if (kind === "topic") {
    return "end";
  }
  if (kind === "thread") {
    return "start";
  }
  return "middle";
}

function labelX(node: GraphLayoutNode): number {
  if (node.kind === "topic") {
    return node.x - LABEL_PAD;
  }
  if (node.kind === "thread") {
    return node.x + LABEL_PAD;
  }
  return node.x;
}

/**
 * Topic ↔ source ↔ thread links, collapsed by default under the loop chart. Opening it fetches
 * `GET /api/v1/knowledge/graph?limit=200`; a host without that route just shows the error line.
 * Layout is a deterministic three-column SVG — no physics, no chart lib.
 */
export function KnowledgeGraphPanel({ counts }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY_GRAPH);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || status !== "idle") {
      return;
    }
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
          setError(data?.error?.message ?? "Could not load the graph");
          setStatus("error");
          return;
        }
        setGraph(normalizeGraph(data));
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the graph");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status]);

  const capped = capGraph(graph, GRAPH_NODE_LIMIT);
  const shown = focus ? egoSubgraph(capped, focus) : capped;
  const layout = layoutGraph(shown);
  const totalNodes = Math.max(counts?.nodes ?? 0, graph.nodes.length);
  const totalEdges = Math.max(counts?.edges ?? 0, graph.edges.length);
  const focusLabel = focus ? (capped.nodes.find((node) => node.id === focus)?.label ?? focus) : null;

  return (
    <section className="blueprint p-[18px]" data-testid="knowledge-graph-panel" aria-label="Knowledge graph">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="btn btn-ghost text-[12px]"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="knowledge-graph-toggle"
        >
          {open ? "Hide graph" : "Show graph"}
        </button>
        <p className="panel-label">Graph</p>
        <p
          className={`text-[12px] ${MUTED}`}
          data-testid="knowledge-graph-counts"
          data-nodes={totalNodes}
          data-edges={totalEdges}
        >
          {totalNodes} nodes · {totalEdges} edges
        </p>
        {focus ? (
          <button
            type="button"
            className="btn btn-ghost ml-auto text-[12px]"
            onClick={() => setFocus(null)}
            data-testid="knowledge-graph-clear-focus"
          >
            Show all
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3">
          {status === "loading" ? (
            <p className={`text-[12px] ${MUTED}`} data-testid="knowledge-graph-loading">
              Loading links…
            </p>
          ) : null}
          {status === "error" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] text-red-700" data-testid="knowledge-graph-error">
                {error ?? "Could not load the graph"}
              </p>
              <button
                type="button"
                className="btn btn-ghost text-[12px]"
                onClick={() => setStatus("idle")}
                data-testid="knowledge-graph-retry"
              >
                Try again
              </button>
            </div>
          ) : null}
          {status === "ready" && capped.nodes.length === 0 ? (
            <p className={`text-[12px] ${MUTED}`} data-testid="knowledge-graph-empty">
              Build map to create topic links.
            </p>
          ) : null}
          {status === "ready" && capped.nodes.length > 0 ? (
            <>
              <p className={`text-[12px] ${MUTED}`} data-testid="knowledge-graph-shown">
                Showing {layout.nodes.length} of {totalNodes} nodes
                {focusLabel ? ` · around ${focusLabel}` : ""}
              </p>
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="mt-2 h-auto w-full"
                role="img"
                aria-label="Topics, sources, and threads, linked by covers, retrieved, and cites edges"
                data-testid="knowledge-graph-svg"
              >
                {layout.edges.map((edge) => (
                  <line
                    key={`${edge.from}-${edge.to}-${edge.kind}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={edgeKindColor(edge.kind)}
                    strokeOpacity={EDGE_OPACITY}
                    strokeWidth={edgeStrokeWidth(edge.weight)}
                  >
                    <title>{`${edge.kind} · weight ${edge.weight}`}</title>
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
                    <title>{`${node.label} (${node.kind})`}</title>
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
                      x={labelX(node)}
                      y={node.kind === "source" ? node.y - LABEL_PAD : node.y + 3}
                      textAnchor={labelAnchor(node.kind)}
                      fill="currentColor"
                      style={{ fontSize: LABEL_FONT, opacity: 0.72 }}
                    >
                      {truncateLabel(node.label)}
                    </text>
                  </g>
                ))}
              </svg>
              <ul
                className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${MUTED}`}
                data-testid="knowledge-graph-legend"
              >
                {GRAPH_NODE_KINDS.map((kind) => (
                  <li key={kind} className="flex items-center gap-1.5" title={NODE_KIND_HINT[kind]}>
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeKindColor(kind) }}
                      aria-hidden
                    />
                    {kind}
                  </li>
                ))}
                {GRAPH_EDGE_KINDS.map((kind) => (
                  <li key={kind} className="flex items-center gap-1.5" title={EDGE_KIND_HINT[kind]}>
                    <span
                      className="inline-block h-0.5 w-4 shrink-0"
                      style={{ backgroundColor: edgeKindColor(kind) }}
                      aria-hidden
                    />
                    {kind}
                  </li>
                ))}
              </ul>
              <p className={`mt-1 text-[12px] ${MUTED}`}>
                Click a node to keep only what it touches; click it again to show all.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
