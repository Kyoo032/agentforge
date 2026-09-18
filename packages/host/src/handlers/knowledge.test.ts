import { describe, expect, it } from "vitest";
import { ARTIFACT_MODES } from "@agentforge/core/artifacts";
import { PASTED_SOURCE_TYPES, WORK_SOURCE_TYPES } from "../knowledge";
import { workTypeForArtifact } from "./knowledge";

/**
 * "Send to Knowledge Base" for a saved artifact. The label the studio sends is shared between desks
 * (Market and Finance both send `Brief`), so the artifact's own mode decides the work type and the
 * label map is only the fallback.
 */
describe("workTypeForArtifact", () => {
  it("derives the work type from the artifact mode, not the shared label", () => {
    expect(workTypeForArtifact("market", "Brief")).toBe("Market");
    expect(workTypeForArtifact("finance", "Brief")).toBe("Finance");
    expect(workTypeForArtifact("research", "Dossier")).toBe("Research");
    expect(workTypeForArtifact("data", "Analysis")).toBe("Data");
    expect(workTypeForArtifact("legal", "Memo")).toBe("Legal");
    expect(workTypeForArtifact("presentations", "Paste")).toBe("Presentation");
    expect(workTypeForArtifact("documents", "Paste")).toBe("Documents");
  });

  it("falls back to the label map when the mode is not one of the analyst desks", () => {
    expect(workTypeForArtifact("unknown-mode", "Dossier")).toBe("Research");
    expect(workTypeForArtifact("unknown-mode", "Analysis")).toBe("Data");
    expect(workTypeForArtifact("unknown-mode", "Brief")).toBe("Finance");
    expect(workTypeForArtifact("unknown-mode", "Memo")).toBe("Legal");
    expect(workTypeForArtifact("unknown-mode", "Playbook")).toBe("Legal");
    // `Paste` carries no desk of its own, so an unknown mode lands on the generic bucket.
    expect(workTypeForArtifact("unknown-mode", "Paste")).toBe("Documents");
  });

  it("answers with a real work source type for every artifact mode and every label", () => {
    for (const mode of ARTIFACT_MODES) {
      for (const label of PASTED_SOURCE_TYPES) {
        expect(WORK_SOURCE_TYPES).toContain(workTypeForArtifact(mode, label));
      }
    }
  });

  it("never files a market briefing as Finance, whatever label the studio sends", () => {
    for (const label of PASTED_SOURCE_TYPES) {
      expect(workTypeForArtifact("market", label)).toBe("Market");
    }
  });
});
