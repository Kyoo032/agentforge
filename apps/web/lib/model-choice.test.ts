import { describe, expect, it } from "vitest";
import { keepModelChoice, modelPickBody, regenModelPick, studioModelPick } from "./model-choice";

const LISTED = [{ id: "gpt-image-2" }, { id: "flux-2-pro" }, { id: "seedream-5" }];

describe("keepModelChoice (a studio reloading its catalog)", () => {
  it("keeps the person's pick when the reloaded list still offers it", () => {
    // The bug: Images/Videos/Music reloaded after every generate and put the host default back.
    expect(keepModelChoice("flux-2-pro", LISTED, "gpt-image-2")).toBe("flux-2-pro");
  });

  it("takes the host default on the first load, when nothing is picked yet", () => {
    expect(keepModelChoice("", LISTED, "seedream-5")).toBe("seedream-5");
  });

  it("falls back to the host default when the pick is no longer offered", () => {
    expect(keepModelChoice("retired-model", LISTED, "seedream-5")).toBe("seedream-5");
  });

  it("falls back to the first listed model when the host names no default", () => {
    expect(keepModelChoice("retired-model", LISTED, "")).toBe("gpt-image-2");
    expect(keepModelChoice("", LISTED, undefined)).toBe("gpt-image-2");
  });

  it("answers empty when there is nothing to pick from", () => {
    expect(keepModelChoice("flux-2-pro", [], "")).toBe("");
    expect(keepModelChoice("", [], undefined)).toBe("");
  });

  it("keeps a host default that the list does not carry, as the studios always did", () => {
    // The picker may be told about a relay-only default it has no option for; that is the host's call.
    expect(keepModelChoice("", LISTED, "suno_music")).toBe("suno_music");
  });
});

describe("studioModelPick (the prompt bar)", () => {
  it("pins only a model the person picked", () => {
    expect(studioModelPick("gpt-5.6-sol", true)).toEqual({ model: "gpt-5.6-sol", modelPinned: true });
    expect(studioModelPick("gpt-5.6-sol", false)).toEqual({ model: "gpt-5.6-sol", modelPinned: false });
  });

  it("never pins an empty model: there is nothing to hold the host to", () => {
    expect(studioModelPick("", true)).toEqual({ model: undefined, modelPinned: false });
    expect(studioModelPick("   ", true)).toEqual({ model: undefined, modelPinned: false });
  });
});

describe("regenModelPick (a rewrite panel seeded with the studio's model)", () => {
  it("is not a pick when the panel still shows the studio's unpinned default", () => {
    // The panel seeds its own select with the studio model, so its model is always set. Reading
    // "a model was sent" as "a model was chosen" pinned every rewrite and disabled the fallback.
    expect(regenModelPick("deepseek-v4-flash", "deepseek-v4-flash", false)).toEqual({
      model: "deepseek-v4-flash",
      modelPinned: false,
    });
  });

  it("is a pick when the panel's own picker moved off the studio model", () => {
    expect(regenModelPick("claude-sonnet-5", "deepseek-v4-flash", false)).toEqual({
      model: "claude-sonnet-5",
      modelPinned: true,
    });
  });

  it("carries the studio's pin when the panel kept the studio's picked model", () => {
    expect(regenModelPick("gpt-5.6-sol", "gpt-5.6-sol", true)).toEqual({ model: "gpt-5.6-sol", modelPinned: true });
  });

  it("uses the studio model when the panel sent none", () => {
    expect(regenModelPick("", "gpt-5.6-sol", true)).toEqual({ model: "gpt-5.6-sol", modelPinned: true });
    expect(regenModelPick(undefined, "gpt-5.6-sol", false)).toEqual({ model: "gpt-5.6-sol", modelPinned: false });
    expect(regenModelPick("", "", true)).toEqual({ model: undefined, modelPinned: false });
  });
});

describe("modelPickBody (the request fields)", () => {
  it("sends modelPinned only when it is true, like the Finance studio always has", () => {
    expect(modelPickBody({ model: "gpt-5.6-sol", modelPinned: true })).toEqual({
      model: "gpt-5.6-sol",
      modelPinned: true,
    });
    expect(modelPickBody({ model: "gpt-5.6-sol", modelPinned: false })).toEqual({ model: "gpt-5.6-sol" });
    expect(modelPickBody({ model: undefined, modelPinned: false })).toEqual({});
  });

  it("serialises to exactly what the host reads", () => {
    expect(JSON.parse(JSON.stringify({ prompt: "p", ...modelPickBody(studioModelPick("m", true)) }))).toEqual({
      prompt: "p",
      model: "m",
      modelPinned: true,
    });
    expect(JSON.parse(JSON.stringify({ prompt: "p", ...modelPickBody(studioModelPick("m", false)) }))).toEqual({
      prompt: "p",
      model: "m",
    });
  });
});
