/**
 * How each studio holds on to, and reports, the model the person chose.
 *
 * The decisions themselves are unit-tested in `model-choice.test.ts`. The studios are components with
 * no DOM to drive in this node environment, so their wiring to those decisions is pinned here by
 * reading the source, the same way `finance-mount-wiring.test.ts` does. The flow is driven live on
 * webdev.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const components = resolve(dirname(fileURLToPath(import.meta.url)), "../components");

function source(name: string): string {
  return readFileSync(resolve(components, name), "utf8");
}

describe("a media studio keeps the chosen model when its gallery reloads", () => {
  for (const file of ["images-studio.tsx", "videos-studio.tsx", "music-studio.tsx"]) {
    it(`${file} re-seeds from the reloaded list without dropping the current pick`, () => {
      const studio = source(file);
      expect(studio).toContain('import { keepModelChoice } from "@/lib/model-choice";');
      expect(studio).toContain(
        "setModel((current) => keepModelChoice(current, data.models ?? [], data.defaultModel));",
      );
      // The old line overwrote the pick (and, on Videos, the clip length that snaps to the model).
      expect(studio).not.toContain("setModel(data.defaultModel ||");
    });
  }
});

describe("a job studio sends modelPinned only for a model the person chose", () => {
  const JOB_STUDIOS: Array<{ file: string; mode: string }> = [
    { file: "documents-studio.tsx", mode: "documents" },
    { file: "presentations-studio.tsx", mode: "presentations" },
    { file: "research-studio.tsx", mode: "research" },
    { file: "data-studio.tsx", mode: "data" },
    { file: "legal-studio.tsx", mode: "legal" },
  ];

  for (const { file, mode } of JOB_STUDIOS) {
    it(`${file} reads the pin from useJobModel and sends it through modelPickBody`, () => {
      const studio = source(file);
      expect(studio).toContain(`const { models, model, pinned: modelPinned, setModel } = useJobModel("${mode}");`);
      expect(studio).toContain("...modelPickBody(studioModelPick(model, modelPinned))");
      // No request may send a bare `model` any more: that is the path that let the fallback swap a pick.
      expect(studio).not.toContain("model: model || undefined");
    });
  }

  for (const file of ["documents-studio.tsx", "presentations-studio.tsx"]) {
    it(`${file} judges a rewrite panel's model against the studio's, not by its presence`, () => {
      const studio = source(file);
      expect(studio).toContain("...modelPickBody(regenModelPick(payload.model, model, modelPinned))");
      expect(studio).not.toContain("model: payload.model || model || undefined");
    });
  }

  it("legal-studio.tsx pins the verifier only when one was picked", () => {
    const studio = source("legal-studio.tsx");
    expect(studio).toContain("...(verifierModel ? { verifierModel, verifierModelPinned: true } : {})");
  });

  it("finance-studio.tsx no longer pins every rewrite because the panel sent its seeded model", () => {
    const studio = source("finance-studio.tsx");
    expect(studio).toContain("...regenModelPick(payload.model, model, modelPinned),");
    expect(studio).not.toContain("modelPinned: Boolean(payload.model) || modelPinned");
  });

  it("market-studio.tsx sends the pin on the stream request", () => {
    const studio = source("market-studio.tsx");
    expect(studio).toContain('const { models, model, pinned: modelPinned, setModel } = useJobModel("market");');
    expect(studio).toContain("...modelPickBody(studioModelPick(model, modelPinned))");
  });
});
