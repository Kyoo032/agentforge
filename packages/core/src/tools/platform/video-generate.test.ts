import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../../tenancy/types";
import { invokeTool } from "../define-tool";
import { runWithToolSecrets } from "../secret-scope";
import { videoGenerateTool } from "./video-generate";

const tenant: TenantContext = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
};

describe("videoGenerateTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the gateway key on /video/generations when no backend was picked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "video_123", task_id: "abcd", status: "processing" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: "SUCCESS", result_url: "https://cdn.example/clip.mp4" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runWithToolSecrets(
      { secrets: { OPENAI_API_KEY: "sk-model", OPENAI_BASE_URL: "https://api.tokotokenai.com/v1" }, backends: {} },
      () => invokeTool(videoGenerateTool, { prompt: "rain on a window" }, tenant),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.tokotokenai.com/v1/video/generations");
    expect(result).toMatchObject({
      success: true,
      backend: "gateway",
      video: "https://cdn.example/clip.mp4",
      model: "grok-imagine-video",
    });
  });

  it("does not spend the chat Ark key on video_generate", async () => {
    const result = await runWithToolSecrets({ secrets: { ARK_API_KEY: "ark-test" }, backends: {} }, () =>
      invokeTool(videoGenerateTool, { prompt: "rain on a window" }, tenant),
    );
    expect(result).toMatchObject({ success: false });
    expect(String((result as { error: string }).error)).toMatch(/gateway|FAL|Toko/i);
  });

  it("routes text-to-video and image-to-video to different FAL endpoints when FAL is selected", async () => {
    const queue = () => [
      {
        ok: true,
        json: async () => ({
          request_id: "1",
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/resp",
        }),
      },
      { ok: true, json: async () => ({ status: "COMPLETED" }) },
      { ok: true, json: async () => ({ video: { url: "https://cdn.fal.ai/clip.mp4" } }) },
    ];
    const fetchMock = vi.fn();
    for (const response of [...queue(), ...queue()]) {
      fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal("fetch", fetchMock);

    await runWithToolSecrets(
      { secrets: { FAL_KEY: "fal-test", OPENAI_API_KEY: "sk-model" }, backends: { video_gen: "fal" } },
      () => invokeTool(videoGenerateTool, { prompt: "rain on a window" }, tenant),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://queue.fal.run/fal-ai/pixverse/v6/text-to-video");

    await runWithToolSecrets(
      { secrets: { FAL_KEY: "fal-test", OPENAI_API_KEY: "sk-model" }, backends: { video_gen: "fal" } },
      () => invokeTool(videoGenerateTool, { prompt: "animate this", image_url: "https://cdn.example/still.png" }, tenant),
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://queue.fal.run/fal-ai/pixverse/v6/image-to-video");
  });

  it("reuses the Ark key only when Seedance is selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cgt-1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "succeeded", content: { video_url: "https://ark.example/out.mp4" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runWithToolSecrets(
      {
        secrets: { ARK_API_KEY: "ark-test", ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3" },
        backends: { video_gen: "volcengine" },
      },
      () => invokeTool(videoGenerateTool, { prompt: "rain on a window" }, tenant),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/contents/generations/tasks");
    expect(result).toMatchObject({ success: true, backend: "volcengine", video: "https://ark.example/out.mp4" });
  });

  it("does not fall through to Seedance when FAL is selected without FAL_KEY", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runWithToolSecrets(
      { secrets: { ARK_API_KEY: "ark-test" }, backends: { video_gen: "fal" } },
      () => invokeTool(videoGenerateTool, { prompt: "rain on a window" }, tenant),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });
});
