import { describe, expect, it } from "vitest";
import { buildPresentationPptx } from "./presentation-pptx";

describe("buildPresentationPptx", () => {
  it("returns a non-empty pptx buffer and a .pptx filename", async () => {
    const { buffer, filename } = await buildPresentationPptx({
      title: "Agentforge Demo",
      slides: [
        { heading: "Why", bullets: ["Local owner", "Gateway-first"], notes: "Open strong" },
        { heading: "How", bullets: ["Prompt", "Preview", "Download"], notes: "" },
      ],
    });
    expect(filename).toBe("Agentforge-Demo.pptx");
    expect(buffer.byteLength).toBeGreaterThan(1000);
    // ZIP / PPTX magic
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it("sanitizes unsafe title characters in the filename", async () => {
    const { filename } = await buildPresentationPptx({
      title: "Q3 / Plan: v2?",
      slides: [{ heading: "A", bullets: ["b"], notes: "" }],
    });
    expect(filename).toMatch(/\.pptx$/);
    expect(filename).not.toMatch(/[/?:]/);
  });
});
