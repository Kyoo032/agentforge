import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingHandoffs,
  handoffHref,
  isHandoffTarget,
  peekPendingHandoff,
  requestModeHandoff,
  subscribeModeHandoff,
  suggestedHandoffPrompt,
  takePendingHandoff,
} from "./mode-handoff";

describe("mode handoff", () => {
  afterEach(() => {
    clearPendingHandoffs();
  });

  it("queues one payload per target and clears it on take", () => {
    const href = requestModeHandoff({ target: "documents", sourceText: "# D", prompt: "Write", artifactId: "a1" });
    expect(href).toBe("/documents");
    expect(peekPendingHandoff("documents")?.artifactId).toBe("a1");
    expect(takePendingHandoff("presentations")).toBeNull();
    expect(takePendingHandoff("documents")?.sourceText).toBe("# D");
    expect(takePendingHandoff("documents")).toBeNull();
  });

  it("replaces an older pending payload for the same target", () => {
    requestModeHandoff({ target: "presentations", sourceText: "old", prompt: "p" });
    requestModeHandoff({ target: "presentations", sourceText: "new", prompt: "p" });
    expect(takePendingHandoff("presentations")?.sourceText).toBe("new");
  });

  it("delivers an already-queued handoff to a late subscriber", () => {
    requestModeHandoff({ target: "documents", sourceText: "S", prompt: "P" });
    const seen: string[] = [];
    const unsubscribe = subscribeModeHandoff("documents", (handoff) => seen.push(handoff.sourceText));
    expect(seen).toEqual(["S"]);
    expect(peekPendingHandoff("documents")).toBeNull();
    unsubscribe();
  });

  it("builds target-specific prompts and hrefs", () => {
    expect(suggestedHandoffPrompt("documents", "Lithium")).toMatch(/memo from "Lithium"/);
    expect(suggestedHandoffPrompt("presentations", "")).toMatch(/presentation/);
    expect(handoffHref("presentations")).toBe("/presentations");
    expect(isHandoffTarget("documents")).toBe(true);
    expect(isHandoffTarget("chat")).toBe(false);
  });
});
