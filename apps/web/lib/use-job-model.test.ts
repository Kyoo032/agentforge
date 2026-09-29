import { describe, expect, it } from "vitest";
import { jobModelAnswer, seedJobModel } from "./use-job-model";

describe("seedJobModel", () => {
  const models = [{ id: "claude-sonnet-5" }, { id: "gpt-5.6-sol" }, { id: "kimi-k3" }];

  it("prefers a Settings override that is still in the catalog", () => {
    expect(
      seedJobModel({
        models,
        catalogDefault: "claude-sonnet-5",
        settingsModel: "kimi-k3",
      }),
    ).toBe("kimi-k3");
  });

  it("falls back to the catalog default when Settings is empty or stale", () => {
    expect(seedJobModel({ models, catalogDefault: "claude-sonnet-5" })).toBe("claude-sonnet-5");
    expect(
      seedJobModel({
        models,
        catalogDefault: "claude-sonnet-5",
        settingsModel: "retired-model",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("falls back to the first catalog id", () => {
    expect(seedJobModel({ models })).toBe("claude-sonnet-5");
    expect(seedJobModel({ models: [] })).toBe("");
  });
});

describe("jobModelAnswer", () => {
  const chat = [
    { id: "gpt-5.6-luna", label: "Luna", inputModalities: ["text"] },
    { id: "deepseek-v4-flash", label: "Flash", inputModalities: ["text"] },
  ];

  it("reads a job mode's models from the one chat catalogue the host sends", () => {
    const answer = jobModelAnswer({
      catalog: { models: chat, modes: { image: [{ id: "gpt-image-2" }] }, defaults: { documents: "deepseek-v4-flash" } },
      settings: {},
      mode: "documents",
    });
    expect(answer.models.map((model) => model.id)).toEqual(["gpt-5.6-luna", "deepseek-v4-flash"]);
    expect(answer.model).toBe("deepseek-v4-flash");
  });

  it("gives every job mode the same catalogue, never a media list", () => {
    const catalog = { models: chat, modes: { image: [{ id: "gpt-image-2" }] }, defaults: {} };
    for (const mode of ["documents", "research", "presentations", "finance", "data", "market", "legal", "meeting"] as const) {
      expect(jobModelAnswer({ catalog, settings: {}, mode }).models.map((model) => model.id), mode).toEqual([
        "gpt-5.6-luna",
        "deepseek-v4-flash",
      ]);
    }
  });

  it("still takes a list the host sends for the mode itself", () => {
    const answer = jobModelAnswer({
      catalog: { models: chat, modes: { legal: [{ id: "legal-only" }] }, defaults: {} },
      settings: {},
      mode: "legal",
    });
    expect(answer.models.map((model) => model.id)).toEqual(["legal-only"]);
  });

  it("starts on the Settings override while the catalogue still has it", () => {
    const answer = jobModelAnswer({
      catalog: { models: chat, defaults: { research: "deepseek-v4-flash" } },
      settings: { researchGenModel: "gpt-5.6-luna" },
      mode: "research",
    });
    expect(answer.model).toBe("gpt-5.6-luna");
  });

  it("is empty, not a throw, on an answer the host did not give", () => {
    expect(jobModelAnswer({ catalog: null, settings: null, mode: "documents" })).toEqual({ models: [], model: "" });
    expect(jobModelAnswer({ catalog: { error: { message: "x" } }, settings: {}, mode: "data" })).toEqual({
      models: [],
      model: "",
    });
  });
});
