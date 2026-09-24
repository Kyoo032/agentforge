import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { GENERATED_IMAGE_MAX_BYTES, GENERATED_VIDEO_MAX_BYTES, downloadGeneratedMedia } from "./media-download";

/**
 * `fetchPublicHttps` resolves every hop's hostname before it fetches, and `downloadGeneratedMedia`
 * takes no resolver of its own. Left to the system resolver, `cdn.example` takes about 11 s to come
 * back ENOTFOUND on Windows, and every case that got past the https check timed out, so the resolver
 * is replaced here. It answers with a public address unless a case says otherwise.
 */
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup,
}));

const PUBLIC_ANSWER = [{ address: "93.184.216.34", family: 4 }];

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue(PUBLIC_ANSWER);
});

function bodyOf(bytes: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

/** A stream that never ends, counting how many chunks the reader actually pulled. */
function endlessBody(chunkBytes: number, pulls: { count: number }): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls.count += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
}

function respondWith(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

/** The CDN answers with a redirect to `location`; every URL actually requested lands in `requested`. */
function redirectingTo(location: string, status: number, requested: string[]): typeof fetch {
  return (async (input: string) => {
    requested.push(input);
    return input.includes("cdn.example")
      ? new Response(null, { status, headers: { location } })
      : new Response(bodyOf(4), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("downloadGeneratedMedia", () => {
  it("returns the body and the served mime for a public https image", async () => {
    const result = await downloadGeneratedMedia("https://cdn.example/out.webp", "image", {
      fetchImpl: respondWith(
        new Response(bodyOf(12), { status: 200, headers: { "content-type": "image/webp; charset=binary" } }),
      ),
    });
    expect(result.mime).toBe("image/webp");
    expect(result.bytes.byteLength).toBe(12);
    // Every address the CDN name answers with is judged, not only the first one.
    expect(lookup).toHaveBeenCalledWith("cdn.example", { all: true });
  });

  it("falls back to the default mime when the server does not name one for the kind", async () => {
    const result = await downloadGeneratedMedia("https://cdn.example/out", "video", {
      fetchImpl: respondWith(new Response(bodyOf(4), { status: 200, headers: { "content-type": "text/plain" } })),
    });
    expect(result.mime).toBe("video/mp4");
  });

  it("rejects a plain http url", async () => {
    await expect(
      downloadGeneratedMedia("http://cdn.example/out.png", "image", {
        fetchImpl: respondWith(new Response(bodyOf(4), { status: 200 })),
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a redirect pointing back at loopback", async () => {
    const requested: string[] = [];
    const fetchImpl = redirectingTo("http://127.0.0.1:8787/admin", 302, requested);
    const download = downloadGeneratedMedia("https://cdn.example/out.png", "image", { fetchImpl });
    await expect(download).rejects.toBeInstanceOf(ApiError);
    await expect(download).rejects.toMatchObject({ code: "invalid_endpoint" });
    // Refused before the hop, not after it: the loopback URL is never requested.
    expect(requested).toEqual(["https://cdn.example/out.png"]);
  });

  it("rejects a redirect to a private https host", async () => {
    const requested: string[] = [];
    const fetchImpl = redirectingTo("https://192.168.0.10/secret", 307, requested);
    const download = downloadGeneratedMedia("https://cdn.example/out.png", "image", { fetchImpl });
    await expect(download).rejects.toBeInstanceOf(ApiError);
    await expect(download).rejects.toMatchObject({ code: "invalid_endpoint" });
    expect(requested).toEqual(["https://cdn.example/out.png"]);
  });

  it("rejects a media host whose name resolves to a private address, without requesting it", async () => {
    const requested: string[] = [];
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const fetchImpl = (async (input: string) => {
      requested.push(input);
      return new Response(bodyOf(4), { status: 200 });
    }) as unknown as typeof fetch;
    const download = downloadGeneratedMedia("https://cdn.example/out.png", "image", { fetchImpl });
    await expect(download).rejects.toBeInstanceOf(ApiError);
    await expect(download).rejects.toMatchObject({ code: "invalid_endpoint" });
    expect(requested).toEqual([]);
  });

  it("rejects an over-cap image before buffering the whole body", async () => {
    const pulls = { count: 0 };
    const chunk = 1024 * 1024;
    await expect(
      downloadGeneratedMedia("https://cdn.example/huge.png", "image", {
        fetchImpl: respondWith(new Response(endlessBody(chunk, pulls), { status: 200 })),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(pulls.count).toBeLessThanOrEqual(GENERATED_IMAGE_MAX_BYTES / chunk + 2);
  });

  it("caps video at the video limit, not the image one", async () => {
    const pulls = { count: 0 };
    const chunk = 1024 * 1024;
    const result = await downloadGeneratedMedia("https://cdn.example/clip.mp4", "video", {
      fetchImpl: respondWith(
        new Response(bodyOf(chunk * 12), { status: 200, headers: { "content-type": "video/mp4" } }),
      ),
    });
    expect(result.bytes.byteLength).toBe(chunk * 12);
    expect(GENERATED_VIDEO_MAX_BYTES).toBeGreaterThan(GENERATED_IMAGE_MAX_BYTES);
    expect(pulls.count).toBe(0);
  });

  it("rejects a non-2xx response", async () => {
    await expect(
      downloadGeneratedMedia("https://cdn.example/gone.png", "image", {
        fetchImpl: respondWith(new Response(bodyOf(0), { status: 404 })),
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
