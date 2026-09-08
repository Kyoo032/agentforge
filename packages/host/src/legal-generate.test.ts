import { describe, expect, it } from "vitest";
import { DOCX_MIME, XLSX_MIME } from "@agentforge/core/artifacts";
import { artifactKindForDeliverable, encodeArtifactBody } from "./legal-generate";

describe("legal generate persist mapping", () => {
  it("maps each deliverable onto the artifact kind the file route expects", () => {
    expect(artifactKindForDeliverable("issues-memo")).toBe("memo");
    expect(artifactKindForDeliverable("redline")).toBe("redline");
    expect(artifactKindForDeliverable("deviation-report")).toBe("report");
    expect(artifactKindForDeliverable("executive-summary")).toBe("summary");
    expect(artifactKindForDeliverable("red-flags")).toBe("red-flags");
  });

  it("stores OOXML as base64 and markdown as text", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(encodeArtifactBody(DOCX_MIME, bytes, "")).toBe(Buffer.from(bytes).toString("base64"));
    expect(encodeArtifactBody(XLSX_MIME, bytes, "ignored")).toBe(Buffer.from(bytes).toString("base64"));
    expect(encodeArtifactBody("text/markdown", bytes, "  High  ")).toBe("High");
  });
});
