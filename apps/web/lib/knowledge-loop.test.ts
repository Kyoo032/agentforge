import { describe, expect, it } from "vitest";
import {
  LOOP_STAGES,
  countSourcesByType,
  formatVerified,
  isWorkSourceType,
  loopStageCounts,
  summarizeLoop,
} from "./knowledge-loop";

const sources = [
  { type: "Paste", status: "Indexed" as const, chunks: 2 },
  { type: "Videos", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Failed" as const, chunks: 0 },
  { type: "URL", status: "Indexed" as const, chunks: 9 },
  { type: "URL", status: "Indexed" as const, chunks: 3 },
  { type: "File", status: "Failed" as const, chunks: 0 },
];

describe("knowledge loop counts", () => {
  it("groups by type with work types first in rail order, then manual by count", () => {
    const counts = countSourcesByType(sources);
    expect(counts.map((row) => row.type)).toEqual(["Chat", "Videos", "URL", "File", "Paste"]);
    expect(counts[0]).toEqual({ type: "Chat", total: 2, indexed: 1, failed: 1, chunks: 1 });
    expect(counts[2]).toEqual({ type: "URL", total: 2, indexed: 2, failed: 0, chunks: 12 });
  });

  it("summarizes work vs manual and index health", () => {
    expect(summarizeLoop(sources)).toEqual({ work: 3, manual: 4, indexed: 5, failed: 2, chunks: 16 });
    expect(summarizeLoop([])).toEqual({ work: 0, manual: 0, indexed: 0, failed: 0, chunks: 0 });
  });

  it("knows which types the loop writes", () => {
    expect(isWorkSourceType("Chat")).toBe(true);
    expect(isWorkSourceType("Edit")).toBe(true);
    expect(isWorkSourceType("Paste")).toBe(false);
    expect(isWorkSourceType("Dossier")).toBe(false);
  });
});

const NOW = 1_760_000_000_000;

describe("loop stages", () => {
  it("runs Work through Verified", () => {
    expect(LOOP_STAGES).toEqual(["Work", "Saved", "Indexed", "Graph", "Retrieved", "Verified"]);
  });

  it("counts one value per stage from the page payload", () => {
    const stages = loopStageCounts(
      {
        sources,
        retrievals: 7,
        graph: { nodes: 12, edges: 30 },
        verified: { ok: true, at: NOW - 120_000, detail: "found the plant" },
      },
      NOW,
    );
    expect(stages.map((stage) => stage.stage)).toEqual([...LOOP_STAGES]);
    expect(stages.map((stage) => stage.label)).toEqual(["3", "7", "5", "12", "7", "pass"]);
    expect(stages[3]?.detail).toBe("30 edges");
    expect(stages[5]?.detail).toBe("2m ago");
    expect(stages[5]?.state).toBe("ok");
  });

  it("degrades to zero and never throws when the host omits the new fields", () => {
    const stages = loopStageCounts({ sources: [] });
    expect(stages.map((stage) => stage.label)).toEqual(["0", "0", "0", "0", "0", "never"]);
    expect(stages[3]?.state).toBe("idle");
    expect(stages[4]?.state).toBe("idle");
    expect(stages[5]?.state).toBe("idle");
    expect(stages[5]?.detail).toBe("no self-check yet");
    expect(loopStageCounts({ sources: [], retrievals: Number.NaN, graph: null, verified: null })[4]?.value).toBe(0);
  });

  it("marks a failed self-check", () => {
    const stages = loopStageCounts(
      { sources: [], verified: { ok: false, at: NOW - 3_600_000, detail: "plant not retrieved" } },
      NOW,
    );
    expect(stages[5]?.label).toBe("fail");
    expect(stages[5]?.state).toBe("fail");
    expect(stages[5]?.detail).toBe("1h ago");
  });

  it("reports failed sources under Indexed", () => {
    const stages = loopStageCounts({ sources }, NOW);
    expect(stages[2]?.value).toBe(5);
    expect(stages[2]?.detail).toBe("2 failed");
  });
});

describe("formatVerified", () => {
  it("says so when a self-check never ran", () => {
    expect(formatVerified(null, NOW)).toBe("no self-check yet");
    expect(formatVerified(undefined, NOW)).toBe("no self-check yet");
  });

  it("renders a relative time", () => {
    expect(formatVerified({ ok: true, at: NOW - 5_000, detail: "" }, NOW)).toBe("just now");
    expect(formatVerified({ ok: true, at: NOW - 300_000, detail: "" }, NOW)).toBe("5m ago");
    expect(formatVerified({ ok: true, at: NOW - 7_200_000, detail: "" }, NOW)).toBe("2h ago");
    expect(formatVerified({ ok: true, at: NOW - 172_800_000, detail: "" }, NOW)).toBe("2d ago");
    expect(formatVerified({ ok: true, at: NOW + 60_000, detail: "" }, NOW)).toBe("just now");
  });

  it("survives a broken timestamp", () => {
    expect(formatVerified({ ok: true, at: 0, detail: "" }, NOW)).toBe("time unknown");
    expect(formatVerified({ ok: true, at: Number.NaN, detail: "" }, NOW)).toBe("time unknown");
  });
});
