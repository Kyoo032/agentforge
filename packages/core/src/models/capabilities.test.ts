import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { assertAgentSupportsModality, assertModelSupportsModality, getModelModalities } from "./capabilities";

describe("getModelModalities", () => {
  it("gives the gateway default text, image, and video", () => {
    expect(getModelModalities("default")).toEqual({
      text: true,
      image: true,
      video: true,
    });
  });

  it("gives gemini text image and video", () => {
    expect(getModelModalities("gemini-3.6-flash")).toEqual({
      text: true,
      image: true,
      video: true,
    });
  });

  it("gives gpt-5 image but not video", () => {
    expect(getModelModalities("gpt-5-mini")).toMatchObject({ image: true, video: false });
    expect(getModelModalities("gpt-5.6-sol")).toMatchObject({ text: true, image: true, video: false });
  });

  it("gives gemma image but not video", () => {
    expect(getModelModalities("gemma-4-31b-it")).toMatchObject({ image: true, video: false });
  });

  it("gives Seedance text image and video", () => {
    expect(getModelModalities("doubao-seedance-2-0-260128")).toEqual({
      text: true,
      image: true,
      video: true,
    });
  });

  it("gives DeepSeek, Kimi, and GLM image but not video", () => {
    expect(getModelModalities("deepseek-v4-pro")).toMatchObject({ image: true, video: false });
    expect(getModelModalities("kimi-k3")).toMatchObject({ image: true, video: false });
    expect(getModelModalities("glm-5.3")).toMatchObject({ image: true, video: false });
  });

  it("gives Claude image but not video", () => {
    expect(getModelModalities("claude-sonnet-5")).toMatchObject({ image: true, video: false });
  });
});

describe("assertModelSupportsModality", () => {
  it("throws model_missing_modality for video on gpt-4o", () => {
    try {
      assertModelSupportsModality("gpt-4o-mini", "video");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("model_missing_modality");
    }
  });
});

describe("assertAgentSupportsModality", () => {
  it("throws modality_not_enabled when image is not listed", () => {
    try {
      assertAgentSupportsModality(["text"], "image");
      throw new Error("expected throw");
    } catch (error) {
      expect((error as ApiError).code).toBe("modality_not_enabled");
    }
  });
});
