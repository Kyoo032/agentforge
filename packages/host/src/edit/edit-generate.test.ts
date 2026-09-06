import { describe, expect, it } from "vitest";
import { parseVideoGenerateBody } from "../studio-generate";
import { ApiError } from "@agentforge/core";

describe("edit generate host (G-20 / G-23)", () => {
  it("returns video_still_unsupported for t2v-only models", () => {
    expect(() =>
      parseVideoGenerateBody({
        prompt: "still",
        imageUrl: "https://cdn.example/a.png",
        model: "mj_video",
      }),
    ).toThrow(ApiError);
    try {
      parseVideoGenerateBody({
        prompt: "still",
        imageUrl: "https://cdn.example/a.png",
        model: "mj_video",
      });
    } catch (error) {
      expect((error as ApiError).code).toBe("video_still_unsupported");
    }
  });
});
