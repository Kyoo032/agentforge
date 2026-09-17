import { describe, expect, it } from "vitest";
import {
  WORK_CARD_BODY_MAX,
  artifactWorkCard,
  chatWorkCard,
  documentDraftMarkdown,
  mediaWorkCard,
  presentationOutlineMarkdown,
  renderWorkCard,
  titleFromPrompt,
} from "./work-cards";

describe("work cards", () => {
  it("renders a self-describing card with mode, pointer, and file", () => {
    const text = renderWorkCard(
      mediaWorkCard({
        kind: "video",
        mediaId: "m1",
        prompt: "Slow pan over a harbor at dusk\nsecond line ignored in title",
        aspect: "16:9",
        model: "veo-3.1-fast",
        url: "/api/v1/media/m1/file",
        seconds: 8,
      }),
    );
    expect(text).toContain("# Slow pan over a harbor at dusk");
    expect(text).toContain("Mode: Videos");
    expect(text).toContain("Model: veo-3.1-fast");
    expect(text).toContain("Pointer: media:m1");
    expect(text).toContain("Duration: 8 s");
    expect(text).toContain("File: /api/v1/media/m1/file");
  });

  it("writes a media card's prompt exactly once", () => {
    const card = mediaWorkCard({
      kind: "image",
      mediaId: "m3",
      prompt: "Slow pan over a harbor at dusk",
      aspect: "16:9",
      model: "gpt-image-2",
      url: "/api/v1/media/m3/file",
    });
    // Header line and body line used to carry it, which doubled the indexed text of a card that is
    // essentially nothing but its prompt, and doubled its term frequency against bm25.
    expect(card.prompt).toBeUndefined();
    const text = renderWorkCard(card);
    expect(text.match(/Slow pan over a harbor at dusk/g)).toHaveLength(2); // the title line and the body line
    expect(text.match(/^Prompt: /gm)).toHaveLength(1);
  });

  it("keeps an artifact card's prompt in the header, where it is not duplicated", () => {
    const text = renderWorkCard(
      artifactWorkCard({
        type: "Research",
        artifactId: "a2",
        title: "Lithium supply",
        prompt: "Who mines the most lithium?",
        markdown: "Australia leads on mined output.",
      }),
    );
    expect(text.match(/^Prompt: /gm)).toHaveLength(1);
    expect(text).not.toContain("File:");
  });

  it("caps the body and marks the cut", () => {
    const card = artifactWorkCard({
      type: "Research",
      artifactId: "a1",
      title: "Lithium",
      prompt: "q",
      markdown: "x".repeat(WORK_CARD_BODY_MAX * 2),
    });
    const text = renderWorkCard(card);
    expect(text.length).toBeLessThanOrEqual(WORK_CARD_BODY_MAX);
    expect(text.endsWith("[truncated]")).toBe(true);
  });

  it("returns empty text for an empty body so the caller can skip", () => {
    expect(renderWorkCard(chatWorkCard({ threadId: "t", title: "T", userText: "", assistantText: "   " }))).toBe("");
  });

  it("lets Edit reuse the media card with its own type", () => {
    const card = mediaWorkCard({
      kind: "image",
      mediaId: "m2",
      prompt: "b-roll",
      aspect: "landscape",
      model: "gpt-image-2",
      url: "/api/v1/media/m2/file",
      type: "Edit",
    });
    expect(card.type).toBe("Edit");
    expect(card.origin).toEqual({ kind: "media", id: "m2" });
  });

  it("keeps a chat card to the latest exchange with per-side caps", () => {
    const card = chatWorkCard({
      threadId: "t1",
      title: "",
      userText: "What is 2 + 3?",
      assistantText: "a".repeat(9_000),
      model: "gpt-5.6",
    });
    expect(card.title).toBe("What is 2 + 3?");
    expect(card.pointer).toBe("thread:t1");
    expect(card.body.startsWith("User: What is 2 + 3?")).toBe(true);
    expect(card.body.length).toBeLessThan(5_200);
  });

  it("serializes drafts and outlines to markdown", () => {
    expect(documentDraftMarkdown({ title: "Memo", sections: [{ heading: "Why", body: "Because." }] })).toBe(
      "# Memo\n\n## Why\n\nBecause.",
    );
    expect(
      presentationOutlineMarkdown({
        title: "Deck",
        slides: [{ heading: "Claim", bullets: ["one", "two"], notes: "push back" }],
      }),
    ).toBe("# Deck\n\n## 1. Claim\n\n- one\n- two\n\nNotes: push back");
  });

  it("shortens long first lines into a title", () => {
    expect(titleFromPrompt("", "Fallback")).toBe("Fallback");
    expect(titleFromPrompt("w".repeat(200), "x").length).toBe(120);
  });
});
