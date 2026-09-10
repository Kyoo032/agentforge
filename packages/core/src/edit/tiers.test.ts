import { describe, expect, it } from "vitest";
import { CAMERA_CHIPS, EDIT_TIERS, routeEditModel } from "./tiers";

describe("routeEditModel G-19", () => {
  it("picks the first live candidate in the requested tier", () => {
    expect(
      routeEditModel({
        kind: "video",
        tier: "draft",
        liveModelIds: ["seedance-2.0-mini", "grok-imagine-video", "seedance-2.0-fast"],
      }),
    ).toBe("grok-imagine-video");
    expect(
      routeEditModel({
        kind: "video",
        tier: "standard",
        liveModelIds: ["grok-imagine-video", "seedance-2.0-fast"],
      }),
    ).toBe("seedance-2.0-fast");
  });

  it("prefers Veo in every tier when the gateway lists it", () => {
    const live = ["seedance-2.0-fast", "seedance-2.5", "grok-imagine-video", "veo_3_1", "veo_3_1-fast"];
    expect(routeEditModel({ kind: "video", tier: "draft", liveModelIds: live })).toBe("veo_3_1-fast");
    expect(routeEditModel({ kind: "video", tier: "standard", liveModelIds: live })).toBe("veo_3_1-fast");
    expect(routeEditModel({ kind: "video", tier: "cinematic", liveModelIds: live })).toBe("veo_3_1");
  });

  it("skips missing ids and never crosses tiers", () => {
    expect(
      routeEditModel({
        kind: "video",
        tier: "draft",
        liveModelIds: ["seedance-2.0-fast", "seedance-2.5"],
      }),
    ).toBeNull();
    expect(
      routeEditModel({
        kind: "video",
        tier: "draft",
        liveModelIds: ["seedance-2.0-mini"],
      }),
    ).toBe("seedance-2.0-mini");
    expect(
      routeEditModel({
        kind: "image",
        tier: "draft",
        liveModelIds: ["seedream-4.0", "mj_imagine"],
      }),
    ).toBe("seedream-4.0");
  });

  it("filters requireImageToVideo within the same tier", () => {
    expect(
      routeEditModel({
        kind: "video",
        tier: "draft",
        liveModelIds: ["grok-imagine-video", "seedance-2.0-mini"],
        requireImageToVideo: true,
      }),
    ).toBe("grok-imagine-video");
    expect(EDIT_TIERS.cinematic.video[0]).toBe("veo_3_1");
    expect(
      routeEditModel({
        kind: "video",
        tier: "cinematic",
        liveModelIds: ["omni-fast-v2v", "kling-v1"],
        requireImageToVideo: true,
      }),
    ).toBe("kling-v1");
  });

  it("exposes camera chip prompt phrases", () => {
    expect(CAMERA_CHIPS.orbit).toMatch(/orbit/i);
    expect(CAMERA_CHIPS.handheld).toMatch(/handheld/i);
    expect(CAMERA_CHIPS["slow push-in"]).toMatch(/push-in/i);
  });
});
