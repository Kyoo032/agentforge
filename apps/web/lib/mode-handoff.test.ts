import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, resetLocaleForTests } from "./i18n";
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
    resetLocaleForTests();
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

  it("hands off an Indonesian prompt when the owner's locale is id", () => {
    applyLocale("id");
    expect(suggestedHandoffPrompt("documents", "Lithium")).toBe(
      'Tulis memo dari "Lithium". Gunakan hanya materi sumber dan kutip sumber-sumbernya.',
    );
    expect(suggestedHandoffPrompt("presentations", "  ")).toMatch(/^Ubah "materi sumber" menjadi presentasi/);
  });

  it("keeps a title with braces literal", () => {
    expect(suggestedHandoffPrompt("documents", "Q3 {subject}")).toMatch(/memo from "Q3 \{subject\}"/);
  });
});
