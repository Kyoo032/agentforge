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

/**
 * A10-5 and A10-4. `status_url` and `response_url` come out of the RESPONSE BODY, so before this
 * they were whatever the upstream said — a compromised or spoofed queue reply could point them at
 * any host and the poller would follow, carrying `Authorization: Key …`. And every one of these
 * calls used fetch's default `redirect: "follow"`, so a 302 re-sent that header to wherever it
 * pointed.
 */
describe("runFalQueue refuses to poll wherever the response body says", () => {
  function submitting(statusUrl: string, responseUrl = "https://queue.fal.run/resp") {
    return vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: "req-1", status_url: statusUrl, response_url: responseUrl }),
    });
  }

  async function run(fetchMock: ReturnType<typeof vi.fn>) {
    return runFalQueue({
      endpoint: "fal-ai/flux-2/klein/9b",
      apiKey: "fal-test",
      payload: { prompt: "a lantern" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      wait: async () => undefined,
      pollMs: 0,
    });
  }

  it("refuses a poll URL on someone else's host, before the first poll", async () => {
    const fetchMock = submitting("https://attacker.example/status");
    await expect(run(fetchMock)).rejects.toThrow();
    // One call: the submit. The key never left for the attacker's host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a response URL on someone else's host too", async () => {
    const fetchMock = submitting("https://queue.fal.run/status", "https://attacker.example/resp");
    await expect(run(fetchMock)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a lookalike host that merely ends with the right name", async () => {
    for (const bad of ["https://queue.fal.run.attacker.example/x", "http://queue.fal.run/x"]) {
      const fetchMock = submitting(bad);
      await expect(run(fetchMock), bad).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("allows fal.run as well as queue.fal.run, which the API really does return", async () => {
    const fetchMock = submitting("https://fal.run/status", "https://fal.run/resp")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ url: "https://cdn.fal.ai/o.png" }] }) });
    await expect(run(fetchMock)).resolves.toBeDefined();
  });

  it("never follows a redirect on a call that carries the key", async () => {
    const fetchMock = submitting("https://queue.fal.run/status")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ url: "https://cdn.fal.ai/o.png" }] }) });
    await run(fetchMock);
    for (const [url, init] of fetchMock.mock.calls) {
      const request = init as RequestInit;
      expect((request.headers as Record<string, string>).Authorization, String(url)).toContain("fal-test");
      expect(request.redirect, String(url)).toBe("manual");
      expect(request.signal, String(url)).toBeDefined();
    }
  });
});
