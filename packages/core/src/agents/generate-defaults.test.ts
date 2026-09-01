import { describe, expect, it } from "vitest";
import { mergeGeneratePins, readGeneratePin, resolveStudioGenerateDefault } from "./generate-defaults";

describe("readGeneratePin", () => {
  it("reads trimmed pins and ignores blanks", () => {
    expect(readGeneratePin({ imageGenModel: " gpt-image-2 " }, "image")).toBe("gpt-image-2");
    expect(readGeneratePin({ imageGenModel: "  " }, "image")).toBeUndefined();
    expect(readGeneratePin({}, "video")).toBeUndefined();
  });
});

describe("mergeGeneratePins", () => {
  it("sets and clears pins without dropping other config", () => {
    const merged = mergeGeneratePins({ keep: true }, { imageGenModel: "gpt-image-2", videoGenModel: "seedance-2.0-fast" });
    expect(merged).toEqual({ keep: true, imageGenModel: "gpt-image-2", videoGenModel: "seedance-2.0-fast" });
    expect(mergeGeneratePins(merged, { imageGenModel: "" })).toEqual({
      keep: true,
      videoGenModel: "seedance-2.0-fast",
    });
  });
});

describe("resolveStudioGenerateDefault", () => {
  it("uses the earliest custom agent pin that unlocks the surface", () => {
    expect(
      resolveStudioGenerateDefault({
        kind: "image",
        catalogPreferred: "gpt-image-2",
        settingsModel: "settings-image",
        sources: [
          {
            slug: "quick-chat",
            createdAt: 1,
            productModes: ["chat"],
            config: { imageGenModel: "should-not-count" },
          },
          {
            slug: "later",
            createdAt: 30,
            productModes: ["chat", "images"],
            config: { imageGenModel: "later-pin" },
          },
          {
            slug: "first",
            createdAt: 10,
            productModes: ["images"],
            config: { imageGenModel: "first-pin" },
          },
        ],
      }),
    ).toBe("first-pin");
  });

  it("falls back to Settings then catalog when no pin exists", () => {
    expect(
      resolveStudioGenerateDefault({
        kind: "video",
        catalogPreferred: "seedance-2.0-fast",
        settingsModel: "desk-video",
        sources: [{ slug: "desk", createdAt: 1, productModes: ["videos"], config: {} }],
      }),
    ).toBe("desk-video");
    expect(
      resolveStudioGenerateDefault({
        kind: "video",
        catalogPreferred: "seedance-2.0-fast",
        sources: [],
      }),
    ).toBe("seedance-2.0-fast");
  });
});
