import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../../tenancy/types";
import { invokeTool, type ToolDefinition } from "../define-tool";
import { fetchPageText, webFetchTool } from "./web-fetch";

/**
 * The SSRF guard resolves every hop's hostname before it fetches (`assertResolvesPublic` in
 * `security/safe-fetch.ts`). The tool gives a caller no way to hand it a resolver, so the system one
 * is replaced here: left real, `example.test` takes about 11 s to come back ENOTFOUND on Windows, and
 * every case that names a host timed out. The stand-in answers with a public address unless a case
 * says otherwise.
 */
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup,
}));

const PUBLIC_ANSWER = [{ address: "93.184.216.34", family: 4 }];

const tenant: TenantContext = { tenantId: "local-tenant", organizationId: "org-1", workspaceId: "ws-1", userId: "user-1", role: "member" };
const tool = webFetchTool as unknown as ToolDefinition;

function stubFetch(body: string, init: { status?: number; contentType?: string } = {}) {
  const mock = vi.fn().mockResolvedValue(
    new Response(body, {
      status: init.status ?? 200,
      headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("webFetchTool", () => {
  beforeEach(() => {
    lookup.mockReset();
    lookup.mockResolvedValue(PUBLIC_ANSWER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an html page as text with its title", async () => {
    const mock = stubFetch(
      "<html><head><title>Doc</title></head><body><main><p>Hello <b>world</b></p></main></body></html>",
    );
    const result = await invokeTool(tool, { url: "https://example.test/doc" }, tenant);
    expect(result).toEqual({
      success: true,
      data: {
        url: "https://example.test/doc",
        finalUrl: "https://example.test/doc",
        title: "Doc",
        text: "Hello world",
        truncated: false,
        contentType: "text/html",
      },
    });
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    // Every address the name answers with is judged, not only the first one.
    expect(lookup).toHaveBeenCalledWith("example.test", { all: true });
  });

  it("refuses non-https, private hosts, and never calls fetch for them", async () => {
    const mock = stubFetch("<p>x</p>");
    for (const url of ["http://example.test/", "https://127.0.0.1/", "https://10.1.2.3/", "https://[::1]/"]) {
      const result = await invokeTool(tool, { url }, tenant);
      expect(result).toMatchObject({ success: false });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses a public-looking name that resolves to a private address, and never fetches it", async () => {
    const mock = stubFetch("<p>metadata</p>");
    lookup.mockResolvedValue([PUBLIC_ANSWER[0], { address: "169.254.169.254", family: 4 }]);
    const result = await invokeTool(tool, { url: "https://metadata.example.test/latest" }, tenant);
    expect(result).toEqual({ success: false, error: "URL must point at a public host" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("reports http errors, binary types, and empty pages as failures", async () => {
    stubFetch("nope", { status: 404 });
    expect(await invokeTool(tool, { url: "https://example.test/missing" }, tenant)).toMatchObject({
      success: false,
      error: expect.stringMatching(/HTTP 404/),
    });
    stubFetch("body { color: red }", { contentType: "text/css" });
    expect(await invokeTool(tool, { url: "https://example.test/site.css" }, tenant)).toMatchObject({
      success: false,
      error: expect.stringMatching(/not readable/),
    });
    stubFetch("PDFBYTES", { contentType: "application/pdf" });
    expect(await invokeTool(tool, { url: "https://example.test/file.pdf" }, tenant)).toMatchObject({
      success: false,
      error: expect.stringMatching(/not readable/),
    });
    stubFetch("<html><body><script>x()</script></body></html>");
    expect(await invokeTool(tool, { url: "https://example.test/empty" }, tenant)).toMatchObject({
      success: false,
      error: expect.stringMatching(/no readable text/),
    });
  });

  it("caps text at maxChars and reads plain text bodies", async () => {
    stubFetch("word ".repeat(1000), { contentType: "text/plain" });
    const page = await fetchPageText("https://example.test/plain", { maxChars: 200 });
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(200 + "\n[truncated]".length);
    expect(page.contentType).toBe("text/plain");
  });
});
