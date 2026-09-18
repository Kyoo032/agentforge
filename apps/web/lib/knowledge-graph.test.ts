import { describe, expect, it } from "vitest";
import {
  GRAPH_DRAW_LIMIT,
  GRAPH_EDGE_COLOR,
  GRAPH_LABEL_MAX,
  GRAPH_LAYOUT,
  GRAPH_NODE_LIMIT,
  capGraph,
  edgeStrokeWidth,
  egoSubgraph,
  graphColumn,
  layoutGraph,
  nodeKindColor,
  normalizeGraph,
  rowGapFor,
  truncateGraphLabel,
} from "./knowledge-graph";

const graph = {
  nodes: [
    { id: "t1", kind: "topic" as const, label: "WeKnora plan" },
    { id: "t2", kind: "topic" as const, label: "Market board" },
    { id: "s1", kind: "source" as const, label: "Planted note" },
    { id: "s2", kind: "source" as const, label: "Chat card" },
    { id: "h1", kind: "thread" as const, label: "What is the code name?" },
  ],
  edges: [
    { from: "t1", to: "s1", kind: "covers" as const, weight: 1 },
    { from: "t1", to: "s2", kind: "covers" as const, weight: 2 },
    { from: "t2", to: "s2", kind: "covers" as const, weight: 1 },
    { from: "s1", to: "h1", kind: "retrieved" as const, weight: 3 },
  ],
};

describe("normalizeGraph", () => {
  it("returns an empty graph for anything that is not a graph payload", () => {
    expect(normalizeGraph(null)).toEqual({ nodes: [], edges: [] });
    expect(normalizeGraph(undefined)).toEqual({ nodes: [], edges: [] });
    expect(normalizeGraph({ nodes: "nope", edges: 3 })).toEqual({ nodes: [], edges: [] });
    expect(normalizeGraph({})).toEqual({ nodes: [], edges: [] });
  });

  it("keeps well-formed nodes and drops junk, unknown kinds, and duplicate ids", () => {
    const parsed = normalizeGraph({
      nodes: [
        { id: "t1", kind: "topic", label: "Topic" },
        { id: "t1", kind: "topic", label: "Duplicate" },
        { id: "x1", kind: "wiki", label: "Unknown kind" },
        { id: "", kind: "source", label: "No id" },
        { kind: "source", label: "Missing id" },
        "nope",
      ],
      edges: [],
    });
    expect(parsed.nodes).toEqual([{ id: "t1", kind: "topic", label: "Topic" }]);
  });

  it("defaults a missing weight to 1 and drops edges with unknown endpoints", () => {
    const parsed = normalizeGraph({
      nodes: [
        { id: "t1", kind: "topic", label: "Topic" },
        { id: "s1", kind: "source", label: "Source" },
      ],
      edges: [
        { from: "t1", to: "s1", kind: "covers" },
        { from: "t1", to: "ghost", kind: "covers", weight: 4 },
        { from: "t1", to: "s1", kind: "links", weight: 2 },
        { from: "t1", to: "s1", kind: "cites", weight: -3 },
      ],
    });
    expect(parsed.edges).toEqual([
      { from: "t1", to: "s1", kind: "covers", weight: 1 },
      { from: "t1", to: "s1", kind: "cites", weight: 1 },
    ]);
  });

  it("falls back to the id when a node has no label", () => {
    const parsed = normalizeGraph({ nodes: [{ id: "s1", kind: "source" }], edges: [] });
    expect(parsed.nodes[0]).toEqual({ id: "s1", kind: "source", label: "s1" });
  });
});

describe("egoSubgraph", () => {
  it("keeps the node, its direct neighbours, and the edges between them", () => {
    const ego = egoSubgraph(graph, "s2");
    expect(ego.nodes.map((node) => node.id)).toEqual(["t1", "t2", "s2"]);
    expect(ego.edges).toEqual([
      { from: "t1", to: "s2", kind: "covers", weight: 2 },
      { from: "t2", to: "s2", kind: "covers", weight: 1 },
    ]);
  });

  it("follows edges in both directions and keeps neighbour-to-neighbour edges", () => {
    const ego = egoSubgraph(graph, "t1");
    expect(ego.nodes.map((node) => node.id)).toEqual(["t1", "s1", "s2"]);
    expect(ego.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["t1->s1", "t1->s2"]);
    expect(egoSubgraph(graph, "s1").nodes.map((node) => node.id)).toEqual(["t1", "s1", "h1"]);
  });

  it("returns an empty graph when the id is unknown", () => {
    expect(egoSubgraph(graph, "ghost")).toEqual({ nodes: [], edges: [] });
    expect(egoSubgraph({ nodes: [], edges: [] }, "t1")).toEqual({ nodes: [], edges: [] });
  });
});

describe("capGraph", () => {
  it("keeps the first N nodes and drops edges that lost an endpoint", () => {
    const capped = capGraph(graph, 3);
    expect(capped.nodes.map((node) => node.id)).toEqual(["t1", "t2", "s1"]);
    expect(capped.edges).toEqual([{ from: "t1", to: "s1", kind: "covers", weight: 1 }]);
  });

  it("is a no-op under the cap and never returns more than the limit", () => {
    expect(capGraph(graph, 200)).toEqual(graph);
    expect(capGraph(graph, 0).nodes).toEqual([]);
    expect(capGraph(graph, -5).nodes).toEqual([]);
    expect(GRAPH_NODE_LIMIT).toBe(200);
  });

  it("draws at most 30 nodes until the reader asks for the rest", () => {
    expect(GRAPH_DRAW_LIMIT).toBe(30);
    expect(GRAPH_DRAW_LIMIT).toBeLessThan(GRAPH_NODE_LIMIT);
    const big = {
      nodes: Array.from({ length: 40 }, (_, index) => ({
        id: `s${index}`,
        kind: "source" as const,
        label: `Source ${index}`,
      })),
      edges: [],
    };
    expect(capGraph(big, GRAPH_DRAW_LIMIT).nodes).toHaveLength(30);
    expect(capGraph(big, GRAPH_NODE_LIMIT).nodes).toHaveLength(40);
  });
});

describe("column assignment, row spacing, and label truncation", () => {
  it("puts topics in the left column, sources in the middle, threads on the right", () => {
    expect(graphColumn("topic")).toBe(0);
    expect(graphColumn("source")).toBe(1);
    expect(graphColumn("thread")).toBe(2);
  });

  it("keeps a comfortable pitch while short and never squeezes below 28px", () => {
    expect(rowGapFor(1)).toBe(GRAPH_LAYOUT.rowGap);
    expect(rowGapFor(10)).toBe(GRAPH_LAYOUT.rowGap);
    expect(rowGapFor(12)).toBe(32);
    expect(rowGapFor(40)).toBe(GRAPH_LAYOUT.minRowGap);
    expect(rowGapFor(0)).toBe(GRAPH_LAYOUT.rowGap);
    expect(rowGapFor(Number.NaN)).toBe(GRAPH_LAYOUT.rowGap);
    expect(GRAPH_LAYOUT.minRowGap).toBe(28);
  });

  it("cuts a long label to 18 characters and leaves a short one alone", () => {
    expect(GRAPH_LABEL_MAX).toBe(18);
    expect(truncateGraphLabel("Planted note")).toBe("Planted note");
    expect(truncateGraphLabel("A very long knowledge topic title").length).toBe(18);
    expect(truncateGraphLabel("A very long knowledge topic title").endsWith("…")).toBe(true);
    expect(truncateGraphLabel("")).toBe("");
  });

  it("draws every edge in one muted ink derived from --text", () => {
    expect(GRAPH_EDGE_COLOR).toContain("var(--text)");
    expect(GRAPH_EDGE_COLOR).toContain("25%");
  });
});

describe("layoutGraph", () => {
  it("puts topics left, sources middle, threads right, deterministically", () => {
    const first = layoutGraph(graph);
    const second = layoutGraph(graph);
    expect(first).toEqual(second);
    const byId = new Map(first.nodes.map((node) => [node.id, node]));
    const topic = byId.get("t1");
    const source = byId.get("s1");
    const thread = byId.get("h1");
    expect(topic && source && thread).toBeTruthy();
    expect((topic?.x ?? 0) < (source?.x ?? 0)).toBe(true);
    expect((source?.x ?? 0) < (thread?.x ?? 0)).toBe(true);
    expect(byId.get("t1")?.y).not.toBe(byId.get("t2")?.y);
  });

  it("hangs each label off its column and never lets two rows collide", () => {
    const laid = layoutGraph(graph);
    const byId = new Map(laid.nodes.map((node) => [node.id, node]));
    const topic = byId.get("t1");
    const source = byId.get("s1");
    const thread = byId.get("h1");
    expect(topic?.labelAnchor).toBe("end");
    expect(topic && topic.labelX < topic.x).toBe(true);
    expect(thread?.labelAnchor).toBe("start");
    expect(thread && thread.labelX > thread.x).toBe(true);
    expect(source?.labelAnchor).toBe("middle");
    expect(source?.labelX).toBe(source?.x);
    expect(source && source.labelY > source.y).toBe(true);
    // A left label must clear the canvas edge, a right label its far side.
    expect((topic?.labelX ?? 0) > 0).toBe(true);
    expect((thread?.labelX ?? 0) < laid.width).toBe(true);
    const topicYs = laid.nodes.filter((node) => node.kind === "topic").map((node) => node.y);
    expect(Math.abs((topicYs[1] ?? 0) - (topicYs[0] ?? 0))).toBeGreaterThanOrEqual(GRAPH_LAYOUT.minRowGap);
  });

  it("truncates the drawn label but keeps the full one for the tooltip", () => {
    const laid = layoutGraph({
      nodes: [{ id: "t1", kind: "topic", label: "An extremely long topic title that will not fit" }],
      edges: [],
    });
    expect(laid.nodes[0]?.labelText.length).toBe(GRAPH_LABEL_MAX);
    expect(laid.nodes[0]?.label).toBe("An extremely long topic title that will not fit");
  });

  it("grows the canvas instead of squeezing rows under 28px", () => {
    const tall = layoutGraph({
      nodes: Array.from({ length: 30 }, (_, index) => ({
        id: `s${index}`,
        kind: "source" as const,
        label: `Source ${index}`,
      })),
      edges: [],
    });
    expect(tall.rowGap).toBeGreaterThanOrEqual(GRAPH_LAYOUT.minRowGap);
    expect(tall.height).toBeGreaterThanOrEqual(29 * GRAPH_LAYOUT.minRowGap);
  });

  it("gives every edge both endpoints and grows the canvas with the tallest column", () => {
    const laid = layoutGraph(graph);
    expect(laid.edges).toHaveLength(4);
    for (const edge of laid.edges) {
      expect(Number.isFinite(edge.x1) && Number.isFinite(edge.y2)).toBe(true);
    }
    const many = layoutGraph({
      nodes: Array.from({ length: 20 }, (_, index) => ({
        id: `s${index}`,
        kind: "source" as const,
        label: `Source ${index}`,
      })),
      edges: [],
    });
    expect(many.height).toBeGreaterThan(laid.height);
  });

  it("handles an empty graph without dividing by zero", () => {
    const laid = layoutGraph({ nodes: [], edges: [] });
    expect(laid.nodes).toEqual([]);
    expect(laid.edges).toEqual([]);
    expect(laid.height).toBeGreaterThan(0);
  });
});

describe("edge and node styling", () => {
  it("scales stroke width with weight and clamps it", () => {
    expect(edgeStrokeWidth(1)).toBe(1);
    expect(edgeStrokeWidth(3)).toBe(2);
    expect(edgeStrokeWidth(999)).toBe(4);
    expect(edgeStrokeWidth(0)).toBe(1);
    expect(edgeStrokeWidth(Number.NaN)).toBe(1);
  });

  it("gives every node kind a stable distinct colour", () => {
    const nodes = [nodeKindColor("topic"), nodeKindColor("source"), nodeKindColor("thread")];
    expect(new Set(nodes).size).toBe(3);
    expect(nodeKindColor("topic")).toBe(nodeKindColor("topic"));
  });
});
