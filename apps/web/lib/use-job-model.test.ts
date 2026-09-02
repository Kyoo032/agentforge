import { describe, expect, it } from "vitest";
import { seedJobModel } from "./use-job-model";

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
