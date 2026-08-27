import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../../tenancy/types";
import { invokeTool } from "../define-tool";
import { runWithToolSecrets } from "../secret-scope";
import { webSearchTool } from "./web-search";

const tenant: TenantContext = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
};

describe("webSearchTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for a tool key instead of using the chat model key", async () => {
    const result = await runWithToolSecrets({ secrets: { OPENAI_API_KEY: "sk-model" }, backends: {} }, () =>
      invokeTool(webSearchTool, { query: "hermes agent" }, tenant),
    );
    expect(result).toMatchObject({ success: false });
    expect(String((result as { error: string }).error)).toMatch(/Tavily or Brave/i);
  });

  it("calls Tavily with the tool key from the secret scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "Hermes", url: "https://example.com", content: "agent" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runWithToolSecrets(
      { secrets: { TAVILY_API_KEY: "tvly-test" }, backends: {} },
      () => invokeTool(webSearchTool, { query: "hermes agent" }, tenant),
    );
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
    expect(result).toMatchObject({
      success: true,
      backend: "tavily",
      data: { web: [{ title: "Hermes", url: "https://example.com", position: 1 }] },
    });
  });

  it("honors a sticky Brave selection even if Tavily is also set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [{ title: "Brave hit", url: "https://brave.example", description: "ok" }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await runWithToolSecrets(
      {
        secrets: { TAVILY_API_KEY: "tvly-test", BRAVE_SEARCH_API_KEY: "bsa-test" },
        backends: { web: "brave-free" },
      },
      () => invokeTool(webSearchTool, { query: "nous" }, tenant),
    );
    const [url] = fetchMock.mock.calls[0] as [string | URL];
    expect(String(url)).toContain("api.search.brave.com");
  });
});
