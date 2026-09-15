import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { GENERATED_IMAGE_MAX_BYTES, GENERATED_VIDEO_MAX_BYTES, downloadGeneratedMedia } from "./media-download";

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

describe("downloadGeneratedMedia", () => {
  it("returns the body and the served mime for a public https image", async () => {
    const result = await downloadGeneratedMedia("https://cdn.example/out.webp", "image", {
      fetchImpl: respondWith(
        new Response(bodyOf(12), { status: 200, headers: { "content-type": "image/webp; charset=binary" } }),
      ),
    });
    expect(result.mime).toBe("image/webp");
    expect(result.bytes.byteLength).toBe(12);
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
    const fetchImpl = (async (input: string) =>
      input.includes("cdn.example")
        ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8787/admin" } })
        : new Response(bodyOf(4), { status: 200 })) as unknown as typeof fetch;
    await expect(downloadGeneratedMedia("https://cdn.example/out.png", "image", { fetchImpl })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("rejects a redirect to a private https host", async () => {
    const fetchImpl = (async (input: string) =>
      input.includes("cdn.example")
        ? new Response(null, { status: 307, headers: { location: "https://192.168.0.10/secret" } })
        : new Response(bodyOf(4), { status: 200 })) as unknown as typeof fetch;
    await expect(downloadGeneratedMedia("https://cdn.example/out.png", "image", { fetchImpl })).rejects.toBeInstanceOf(
      ApiError,
    );
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
