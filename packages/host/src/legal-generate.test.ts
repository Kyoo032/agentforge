import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCX_MIME, XLSX_MIME } from "@agentforge/core/artifacts";
import {
  answeredLegalModels,
  artifactKindForDeliverable,
  encodeArtifactBody,
  pinnedLegalModels,
} from "./legal-generate";

const MODELS = { drafting: "deepseek-v4-flash", verifier: "claude-sonnet-5" };

describe("pinnedLegalModels", () => {
  it("pins the drafting model only when the studio says the person picked it", () => {
    expect([...pinnedLegalModels({ model: "deepseek-v4-flash", modelPinned: true }, MODELS)]).toEqual([
      "deepseek-v4-flash",
    ]);
    expect([...pinnedLegalModels({ model: "deepseek-v4-flash" }, MODELS)]).toEqual([]);
  });

  it("pins the verifier only when one was picked and flagged", () => {
    expect([
      ...pinnedLegalModels({ verifierModel: "claude-sonnet-5", verifierModelPinned: true }, MODELS),
    ]).toEqual(["claude-sonnet-5"]);
    expect([...pinnedLegalModels({ verifierModel: "claude-sonnet-5" }, MODELS)]).toEqual([]);
    expect([...pinnedLegalModels({ verifierModelPinned: true }, MODELS)]).toEqual([]);
    expect([...pinnedLegalModels({ verifierModel: "claude-sonnet-5", verifierModelPinned: "yes" }, MODELS)]).toEqual([]);
  });

  it("pins nothing on a body that is not an object", () => {
    expect(pinnedLegalModels(null, MODELS).size).toBe(0);
    expect(pinnedLegalModels("modelPinned", MODELS).size).toBe(0);
  });
});

describe("answeredLegalModels", () => {
  it("names the requested models when each answered for itself", () => {
    expect(answeredLegalModels(MODELS, {})).toEqual(MODELS);
    expect(answeredLegalModels(MODELS, { "deepseek-v4-flash": "deepseek-v4-flash" })).toEqual(MODELS);
  });

  it("names the stand-in that answered for a role after a fallback", () => {
    expect(answeredLegalModels(MODELS, { "deepseek-v4-flash": "gpt-5.6-luna" })).toEqual({
      drafting: "gpt-5.6-luna",
      verifier: "claude-sonnet-5",
    });
  });
});

describe("generateLegalRun wiring", () => {
  // The run needs a matter, its documents and the whole legal pipeline; the two decisions above are
  // tested directly and their use is pinned here by reading the source.
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "legal-generate.ts"), "utf8");

  it("hands each call its pin as modelExplicit", () => {
    expect(source).toContain("const pinned = pinnedLegalModels(body, models);");
    expect(source).toContain("modelExplicit: pinned.has(model),");
  });

  it("records the models that answered, not the ones requested", () => {
    expect(source).toContain("const used = answeredLegalModels(models, answeredFor);");
    expect(source).toContain("const meta = { model: used.drafting, models: [used.drafting, used.verifier]");
    expect(source).toContain("knowledgeCard(matter, artifacts, result.deliverables, used.drafting)");
  });
});

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
