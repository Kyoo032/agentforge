/**
 * Pure helpers for the Knowledge graph panel: parse the host payload, cap it, cut an ego
 * neighbourhood, and lay it out deterministically in kind-based columns (no physics lib).
 */

import { chartPalette, truncateLabel } from "@/lib/chart-scale";

export const GRAPH_NODE_KINDS = ["topic", "source", "thread"] as const;
export const GRAPH_EDGE_KINDS = ["covers", "retrieved", "cites"] as const;

export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export type GraphNode = { id: string; kind: GraphNodeKind; label: string };
export type GraphEdge = { from: string; to: string; kind: GraphEdgeKind; weight: number };
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** The host caps `GET /api/v1/knowledge/graph?limit=200`; the panel refuses to draw more. */
export const GRAPH_NODE_LIMIT = 200;

/** What the map draws before the reader asks for the rest. Keeps the picture readable. */
export const GRAPH_DRAW_LIMIT = 30;

/** Node labels are cut to this many characters; the full text stays in the `<title>`. */
export const GRAPH_LABEL_MAX = 18;

const NODE_KIND_SET = new Set<string>(GRAPH_NODE_KINDS);
const EDGE_KIND_SET = new Set<string>(GRAPH_EDGE_KINDS);

/** Palette index per kind. Order is the CVD-safety mechanism; never re-sort. */
const NODE_KIND_COLOR: Record<GraphNodeKind, number> = { topic: 0, source: 2, thread: 3 };

export function nodeKindColor(kind: GraphNodeKind): string {
  return chartPalette(NODE_KIND_COLOR[kind] ?? 0);
}

/**
 * Every edge is drawn in one muted ink, whatever its kind: crossing lines in six colours were
 * the thing that made this panel unreadable. The kinds are named in the legend instead.
 */
export const GRAPH_EDGE_COLOR = "color-mix(in srgb, var(--text) 25%, transparent)";

const MIN_STROKE = 1;
const MAX_STROKE = 4;
const STROKE_PER_WEIGHT = 0.5;

/** Line weight for an edge: 1px at weight 1, capped at 4px so a hot edge cannot swamp the panel. */
export function edgeStrokeWidth(weight: number): number {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 1) {
    return MIN_STROKE;
  }
  return Math.min(MAX_STROKE, MIN_STROKE + (weight - 1) * STROKE_PER_WEIGHT);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Untrusted payload in, drawable graph out. Junk rows are dropped, never thrown on. */
export function normalizeGraph(value: unknown): KnowledgeGraph {
  const payload = asRecord(value);
  if (!payload) {
    return { nodes: [], edges: [] };
  }
  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload.edges) ? payload.edges : [];
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const entry of rawNodes) {
    const row = asRecord(entry);
    if (!row) {
      continue;
    }
    const id = asText(row.id);
    const kind = asText(row.kind);
    if (!id || seen.has(id) || !NODE_KIND_SET.has(kind)) {
      continue;
    }
    seen.add(id);
    nodes.push({ id, kind: kind as GraphNodeKind, label: asText(row.label) || id });
  }
  const edges: GraphEdge[] = [];
  for (const entry of rawEdges) {
    const row = asRecord(entry);
    if (!row) {
      continue;
    }
    const from = asText(row.from);
    const to = asText(row.to);
    const kind = asText(row.kind);
    if (!seen.has(from) || !seen.has(to) || !EDGE_KIND_SET.has(kind)) {
      continue;
    }
    const weight = typeof row.weight === "number" && Number.isFinite(row.weight) ? row.weight : 1;
    edges.push({ from, to, kind: kind as GraphEdgeKind, weight: weight > 1 ? weight : 1 });
  }
  return { nodes, edges };
}

/** The node, everything one hop away, and every edge whose ends both survived. */
export function egoSubgraph(graph: KnowledgeGraph, id: string): KnowledgeGraph {
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.some((node) => node.id === id)) {
    return { nodes: [], edges: [] };
  }
  const keep = new Set<string>([id]);
  for (const edge of graph.edges) {
    if (edge.from === id) {
      keep.add(edge.to);
    }
    if (edge.to === id) {
      keep.add(edge.from);
    }
  }
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
  };
}

/** Keep the first `limit` nodes and drop any edge that lost an endpoint. */
export function capGraph(graph: KnowledgeGraph, limit: number = GRAPH_NODE_LIMIT): KnowledgeGraph {
  const max = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 0;
  if (graph.nodes.length <= max) {
    return graph;
  }
  const nodes = graph.nodes.slice(0, max);
  const keep = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)) };
}

export type GraphLabelAnchor = "start" | "middle" | "end";

export type GraphLayoutNode = GraphNode & {
  x: number;
  y: number;
  /** Where the label sits — beside the node for the outer columns, under it in the middle. */
  labelX: number;
  labelY: number;
  labelAnchor: GraphLabelAnchor;
  /** The drawn (truncated) text. `label` stays intact for the `<title>` tooltip. */
  labelText: string;
};
export type GraphLayoutEdge = GraphEdge & { x1: number; y1: number; x2: number; y2: number };
export type GraphLayout = {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  width: number;
  height: number;
  /** The row pitch this layout settled on, so a caller can assert it never squeezes. */
  rowGap: number;
};

export const GRAPH_LAYOUT = {
  /**
   * Wide enough that an 18-character label clears the column it hangs off without being
   * clipped by the viewBox — caps-heavy ids ("KBFLOWTEXTA marke…") are the wide case.
   */
  width: 860,
  columnInset: 168,
  rowGap: 34,
  /** Rows never come closer than this; a tall column grows the SVG instead. */
  minRowGap: 28,
  padY: 30,
  minHeight: 140,
  labelPad: 12,
  /** Middle-column labels drop below the dot by this much. */
  labelDrop: 18,
  /** Baseline nudge for a label set beside a dot. */
  labelRise: 4,
} as const;

const COLUMN_ORDER: GraphNodeKind[] = ["topic", "source", "thread"];

/** Column index per kind: sources in the middle, topics left, threads right. */
export function graphColumn(kind: GraphNodeKind): number {
  const index = COLUMN_ORDER.indexOf(kind);
  return index === -1 ? 1 : index;
}

/**
 * Row pitch for a column of `count` nodes: comfortable while the column is short, tightening
 * to `minRowGap` and no further. Past that the canvas gets taller rather than denser.
 */
export function rowGapFor(count: number): number {
  const rows = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 1;
  if (rows <= 10) {
    return GRAPH_LAYOUT.rowGap;
  }
  return Math.max(GRAPH_LAYOUT.minRowGap, GRAPH_LAYOUT.rowGap - (rows - 10));
}

/** Drawn node label: cut to `GRAPH_LABEL_MAX`, ellipsis included. */
export function truncateGraphLabel(label: string): string {
  return truncateLabel(typeof label === "string" ? label : "", GRAPH_LABEL_MAX);
}

function columnX(kind: GraphNodeKind, width: number): number {
  if (kind === "topic") {
    return GRAPH_LAYOUT.columnInset;
  }
  if (kind === "thread") {
    return width - GRAPH_LAYOUT.columnInset;
  }
  return width / 2;
}

/** Label placement for one node, so the component never does geometry of its own. */
function labelFor(
  kind: GraphNodeKind,
  x: number,
  y: number,
  label: string,
): Pick<GraphLayoutNode, "labelX" | "labelY" | "labelAnchor" | "labelText"> {
  const labelText = truncateGraphLabel(label);
  if (kind === "topic") {
    return { labelX: x - GRAPH_LAYOUT.labelPad, labelY: y + GRAPH_LAYOUT.labelRise, labelAnchor: "end", labelText };
  }
  if (kind === "thread") {
    return { labelX: x + GRAPH_LAYOUT.labelPad, labelY: y + GRAPH_LAYOUT.labelRise, labelAnchor: "start", labelText };
  }
  return { labelX: x, labelY: y + GRAPH_LAYOUT.labelDrop, labelAnchor: "middle", labelText };
}

/**
 * Deterministic three-column layout: topics left, sources middle, threads right, each column
 * centred vertically in input order. Same graph in, same coordinates out — no simulation.
 */
export function layoutGraph(graph: KnowledgeGraph, width: number = GRAPH_LAYOUT.width): GraphLayout {
  const byKind = new Map<GraphNodeKind, GraphNode[]>(COLUMN_ORDER.map((kind) => [kind, []]));
  for (const node of graph.nodes) {
    byKind.get(node.kind)?.push(node);
  }
  const tallest = COLUMN_ORDER.reduce((acc, kind) => Math.max(acc, byKind.get(kind)?.length ?? 0), 0);
  const rowGap = rowGapFor(tallest);
  const height = Math.max(GRAPH_LAYOUT.minHeight, (Math.max(tallest, 1) - 1) * rowGap + GRAPH_LAYOUT.padY * 2);
  const placed: GraphLayoutNode[] = [];
  for (const kind of COLUMN_ORDER) {
    const column = byKind.get(kind) ?? [];
    const top = height / 2 - ((column.length - 1) * rowGap) / 2;
    column.forEach((node, index) => {
      const x = columnX(kind, width);
      const y = top + index * rowGap;
      placed.push({ ...node, x, y, ...labelFor(kind, x, y, node.label) });
    });
  }
  const positions = new Map(placed.map((node) => [node.id, node]));
  const edges: GraphLayoutEdge[] = [];
  for (const edge of graph.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      continue;
    }
    edges.push({ ...edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  return { nodes: placed, edges, width, height, rowGap };
}
