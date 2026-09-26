import { describe, expect, it } from "vitest";
import { formatVideoGatewayFailure } from "../tools/platform/gateway-media";
import {
  availableVideoDefault,
  isModelNotOnKey,
  modelNotOnKeyMessage,
  resolveVideoModelForKey,
  rewriteModelNotOnKey,
} from "./key-models";

const PROBED = ["grok-imagine-video", "gpt-4o-mini", "veo_3_1-fast"];

describe("video models the key listed", () => {
  it("does not invent a default when the refresh listed no video model", () => {
    expect(availableVideoDefault([])).toBe("");
    expect(availableVideoDefault(["gpt-4o-mini", "doubao-seed-1-6-250615"])).toBe("");
  });

  it("picks a preferred id only from the ids it was given", () => {
    expect(availableVideoDefault(PROBED)).toBe("veo_3_1-fast");
    expect(availableVideoDefault(["seedance-2.0", "grok-imagine-video"])).toBe("grok-imagine-video");
  });

  it("refuses a model the refresh did not list and names one it did", () => {
    const choice = resolveVideoModelForKey({
      requested: "doubao-seedance-2-0-260128",
      availableIds: PROBED,
    });
    expect(choice).toEqual({
      ok: false,
      rejected: "doubao-seedance-2-0-260128",
      suggestion: "veo_3_1-fast",
    });
  });

  it("keeps a requested id the refresh did list", () => {
    expect(resolveVideoModelForKey({ requested: "grok-imagine-video", availableIds: PROBED })).toEqual({
      ok: true,
      model: "grok-imagine-video",
    });
  });
});

describe("model not on this key", () => {
  const gateway = "The requested model is not available for this key.";

  it("recognises the gateway sentence, including after the 400 pass-through", () => {
    expect(isModelNotOnKey(gateway)).toBe(true);
    expect(isModelNotOnKey(formatVideoGatewayFailure(400, gateway))).toBe(true);
    expect(isModelNotOnKey("Video generation failed")).toBe(false);
  });

  it("replaces the gateway sentence with a plain message and another listed model", () => {
    const rewritten = rewriteModelNotOnKey(formatVideoGatewayFailure(400, gateway), "en", "seedance-2.0", [
      "seedance-2.0",
      "grok-imagine-video",
    ]);
    expect(rewritten).toEqual({
      message: "seedance-2.0 is not available on this key. Try grok-imagine-video.",
      suggestModel: "grok-imagine-video",
    });
    expect(rewritten?.message).not.toMatch(/requested model/i);
  });

  it("writes the same fact in Indonesian when there is no other model", () => {
    expect(modelNotOnKeyMessage("id", "seedance-2.0")).toBe(
      "seedance-2.0 tidak tersedia pada kunci ini. Segarkan model di Pengaturan dan pilih salah satu yang tercantum pada kunci ini.",
    );
    expect(rewriteModelNotOnKey(gateway, "id", "seedance-2.0", ["seedance-2.0"])).toEqual({
      message:
        "seedance-2.0 tidak tersedia pada kunci ini. Segarkan model di Pengaturan dan pilih salah satu yang tercantum pada kunci ini.",
    });
  });
});
