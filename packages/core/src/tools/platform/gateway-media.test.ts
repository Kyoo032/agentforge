import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors";
import {
  extractGatewayVideoUrl,
  generateGatewayImage,
  generateGatewayVideo,
  openaiImageSize,
  parseGatewayImage,
  readGatewayError,
  videoTaskId,
} from "./gateway-media";

describe("parse helpers", () => {
  it("reads OpenAI url and b64 image payloads", () => {
    expect(parseGatewayImage({ data: [{ url: "https://cdn.example/a.png" }] })).toBe("https://cdn.example/a.png");
    expect(parseGatewayImage({ data: [{ b64_json: "abc" }] })).toBe("data:image/png;base64,abc");
    expect(parseGatewayImage({ data: [{ file_output: { public_url: "https://cdn.example/fo.png" } }] })).toBe(
      "https://cdn.example/fo.png",
    );
  });

  it("reads nested, object, and top-level image URL shapes", () => {
    expect(parseGatewayImage({ data: { result_url: "https://cdn.example/r.png", status: "SUCCESS" } })).toBe(
      "https://cdn.example/r.png",
    );
    expect(parseGatewayImage({ data: { url: "https://cdn.example/obj.png" } })).toBe("https://cdn.example/obj.png");
    expect(parseGatewayImage({ data: { data: [{ url: "https://cdn.example/nested.png" }] } })).toBe(
      "https://cdn.example/nested.png",
    );
    expect(parseGatewayImage({ url: "https://cdn.example/top.png" })).toBe("https://cdn.example/top.png");
  });

  it("reads NewAPI video task ids and result URLs", () => {
    expect(videoTaskId({ task_id: "abcd", id: "video_123" })).toBe("abcd");
    expect(videoTaskId({ id: "video_123" })).toBe("video_123");
    expect(extractGatewayVideoUrl({ data: { result_url: "https://cdn.example/a.mp4" } })).toBe(
      "https://cdn.example/a.mp4",
    );
    expect(extractGatewayVideoUrl({ status: "succeeded", url: "https://cdn.example/b.mp4" })).toBe(
      "https://cdn.example/b.mp4",
    );
  });

  it("surfaces new_api_error messages", () => {
    expect(
      readGatewayError(
        { error: { type: "new_api_error", code: "model_not_found", message: "No available channel" } },
        "fallback",
      ),
    ).toBe("No available channel");
  });

  it("maps aspect ratios to OpenAI image sizes", () => {
    expect(openaiImageSize("square")).toBe("1024x1024");
    expect(openaiImageSize("landscape")).toBe("1536x1024");
    expect(openaiImageSize("portrait")).toBe("1024x1536");
  });
});

describe("generateGatewayImage", () => {
  it("POSTs /images/generations and does not send response_format", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://cdn.example/out.png" }] }),
    });
    const result = await generateGatewayImage({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "a lantern",
      aspectRatio: "square",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tokotokenai.com/v1/images/generations");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "gpt-image-2",
      prompt: "a lantern",
      size: "1024x1024",
      quality: "medium",
    });
    expect(result).toEqual({ url: "https://cdn.example/out.png", model: "gpt-image-2" });
  });

  it("sends quality medium for gpt-image models and omits it for others", async () => {
    const gptFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://cdn.example/gpt.png" }] }),
    });
    await generateGatewayImage({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "a",
      fetchImpl: gptFetch as unknown as typeof fetch,
    });
    expect(JSON.parse(String((gptFetch.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      quality: "medium",
    });

    const otherFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://cdn.example/other.png" }] }),
    });
    await generateGatewayImage({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "flux-schnell",
      prompt: "a",
      fetchImpl: otherFetch as unknown as typeof fetch,
    });
    expect(JSON.parse(String((otherFetch.mock.calls[0]?.[1] as RequestInit).body))).not.toHaveProperty("quality");
  });

  it("succeeds when HTTP is not ok but the body still contains an image URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: { message: "need quota" },
        data: [{ url: "https://cdn.example/a.png" }],
      }),
    });
    const result = await generateGatewayImage({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "a lantern",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ url: "https://cdn.example/a.png", model: "gpt-image-2" });
  });

  it("polls GET /images/generations/{id} when POST returns a task id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task_id: "img_1", status: "processing" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { status: "SUCCESS", result_url: "https://cdn.example/done.png" },
        }),
      });
    const result = await generateGatewayImage({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "a lantern",
      fetchImpl: fetchMock as unknown as typeof fetch,
      wait: async () => undefined,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tokotokenai.com/v1/images/generations");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.tokotokenai.com/v1/images/generations/img_1");
    expect(result).toEqual({ url: "https://cdn.example/done.png", model: "gpt-image-2" });
  });

  it("tells the caller not to retry when the fetch times out", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    await expect(
      generateGatewayImage({
        baseUrl: "https://api.tokotokenai.com/v1",
        apiKey: "sk-test",
        model: "gpt-image-2",
        prompt: "a lantern",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/billed|do not retry|already/i) });
  });

  it("throws the gateway error body on 503 without an image URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: { type: "new_api_error", code: "model_not_found", message: "No available channel for model gpt-image-2" },
      }),
    });
    await expect(
      generateGatewayImage({
        baseUrl: "https://api.tokotokenai.com/v1",
        apiKey: "sk-test",
        model: "gpt-image-2",
        prompt: "a lantern",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ message: "No available channel for model gpt-image-2" });
  });
});

describe("generateGatewayVideo", () => {
  it("POSTs /video/generations then polls GET /video/generations/{id}", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "video_123", task_id: "abcd", status: "processing" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "success",
          data: { task_id: "abcd", status: "SUCCESS", result_url: "https://cdn.example/clip.mp4" },
        }),
      });
    const result = await generateGatewayVideo({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "grok-imagine-video",
      prompt: "rain on a window",
      aspectRatio: "16:9",
      fetchImpl: fetchMock as unknown as typeof fetch,
      wait: async () => undefined,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tokotokenai.com/v1/video/generations");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      model: "grok-imagine-video",
      prompt: "rain on a window",
      duration: 5,
      size: "1280x720",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.tokotokenai.com/v1/video/generations/abcd");
    expect(result).toEqual({ url: "https://cdn.example/clip.mp4", model: "grok-imagine-video" });
  });

  it("returns immediately when submit already has a URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: "https://cdn.example/ready.mp4" }),
    });
    const result = await generateGatewayVideo({
      baseUrl: "https://api.tokotokenai.com/v1",
      apiKey: "sk-test",
      model: "grok-imagine-video",
      prompt: "rain",
      fetchImpl: fetchMock as unknown as typeof fetch,
      wait: async () => undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.url).toBe("https://cdn.example/ready.mp4");
  });

  it("throws when the poll reports failure or the job times out", async () => {
    const failed = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task_id: "abcd", status: "processing" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: "failed", fail_reason: "quota" } }),
      });
    await expect(
      generateGatewayVideo({
        baseUrl: "https://api.tokotokenai.com/v1",
        apiKey: "sk-test",
        model: "grok-imagine-video",
        prompt: "rain",
        fetchImpl: failed as unknown as typeof fetch,
        wait: async () => undefined,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/quota|failed/i) });

    const timedOut = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "abcd", status: "processing" }),
    });
    await expect(
      generateGatewayVideo({
        baseUrl: "https://api.tokotokenai.com/v1",
        apiKey: "sk-test",
        model: "grok-imagine-video",
        prompt: "rain",
        fetchImpl: timedOut as unknown as typeof fetch,
        wait: async () => undefined,
        maxPolls: 2,
        pollMs: 1,
      }),
    ).rejects.toMatchObject({ message: "Gateway video job timed out" });
  });

  it("does not call /videos/generations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Model name not specified, model name cannot be empty" } }),
    });
    await expect(
      generateGatewayVideo({
        baseUrl: "https://api.tokotokenai.com/v1",
        apiKey: "sk-test",
        model: "",
        prompt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
        wait: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/videos/generations");
  });
});
