import { describe, expect, it, vi } from "vitest";
import { runFalQueue, falImageUrl, falVideoUrl } from "./fal-queue";

describe("runFalQueue", () => {
  it("submits with Key auth and polls until the result URL is ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: "req-1",
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/resp",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "IN_QUEUE" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ images: [{ url: "https://cdn.fal.ai/out.png" }] }),
      });

    const body = await runFalQueue({
      endpoint: "fal-ai/flux-2/klein/9b",
      apiKey: "fal-test",
      payload: { prompt: "a lantern" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      wait: async () => undefined,
      pollMs: 0,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://queue.fal.run/fal-ai/flux-2/klein/9b");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: "Key fal-test",
    });
    expect(falImageUrl(body)).toBe("https://cdn.fal.ai/out.png");
  });

  it("reads a nested video URL", () => {
    expect(falVideoUrl({ video: { url: "https://cdn.fal.ai/clip.mp4" } })).toBe("https://cdn.fal.ai/clip.mp4");
  });
});
