import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { assertPublicHttpsUrl, fetchPublicHttps, nextHopUrl } from "./safe-fetch";

type Step = { status: number; headers?: Record<string, string>; body?: string };

function fakeFetch(plan: Record<string, Step>, seen: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);
    const step = plan[url];
    if (!step) {
      throw new Error(`unexpected fetch ${url}`);
    }
    return new Response(step.body ?? "", { status: step.status, headers: step.headers ?? {} });
  }) as typeof fetch;
}

describe("assertPublicHttpsUrl", () => {
  it("accepts public https and rejects everything else", () => {
    expect(assertPublicHttpsUrl("https://example.test/report").hostname).toBe("example.test");
    for (const bad of [
      "http://example.test",
      "https://user:pw@example.test",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://169.254.169.254/latest/meta-data",
      "https://192.168.1.1/",
      "https://172.16.0.9/",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://printer.local/",
      "not a url",
    ]) {
      expect(() => assertPublicHttpsUrl(bad), bad).toThrow(ApiError);
    }
  });

  it("resolves relative redirects and re-validates them", () => {
    expect(nextHopUrl("https://a.test/dir/page", "/next")).toBe("https://a.test/next");
    expect(nextHopUrl("https://a.test/", null)).toBeNull();
    expect(() => nextHopUrl("https://a.test/", "http://127.0.0.1:3000/api/v1/settings")).toThrow(/HTTPS/);
    expect(() => nextHopUrl("https://a.test/", "https://169.254.169.254/")).toThrow(/public host/);
  });
});

describe("fetchPublicHttps", () => {
  it("follows safe redirects and returns the final body", async () => {
    const seen: string[] = [];
    const result = await fetchPublicHttps("https://a.test/start", {
      fetchImpl: fakeFetch(
        {
          "https://a.test/start": { status: 302, headers: { location: "https://b.test/final" } },
          "https://b.test/final": { status: 200, headers: { "content-type": "text/html" }, body: "<p>hi</p>" },
        },
        seen,
      ),
    });
    expect(seen).toEqual(["https://a.test/start", "https://b.test/final"]);
    expect(result).toMatchObject({ finalUrl: "https://b.test/final", status: 200, contentType: "text/html" });
    expect(result.body.toString("utf8")).toBe("<p>hi</p>");
  });

  it("stops at a redirect into the local network", async () => {
    const seen: string[] = [];
    await expect(
      fetchPublicHttps("https://a.test/start", {
        fetchImpl: fakeFetch(
          { "https://a.test/start": { status: 301, headers: { location: "http://127.0.0.1:3000/" } } },
          seen,
        ),
      }),
    ).rejects.toThrow(/HTTPS/);
    expect(seen).toEqual(["https://a.test/start"]);
  });

  it("caps hops and body size", async () => {
    const loop: Record<string, Step> = {};
    for (let i = 0; i < 8; i += 1) {
      loop[`https://a.test/${i}`] = { status: 302, headers: { location: `https://a.test/${i + 1}` } };
    }
    await expect(fetchPublicHttps("https://a.test/0", { fetchImpl: fakeFetch(loop, []), maxHops: 3 })).rejects.toThrow(
      /Too many redirects/,
    );
    await expect(
      fetchPublicHttps("https://a.test/big", {
        fetchImpl: fakeFetch({ "https://a.test/big": { status: 200, body: "x".repeat(50) } }, []),
        maxBytes: 10,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("maps a caller cancel to an aborted ApiError", async () => {
    const controller = new AbortController();
    controller.abort();
    const never = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(
      fetchPublicHttps("https://a.test/x", { fetchImpl: never, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
  });
});
