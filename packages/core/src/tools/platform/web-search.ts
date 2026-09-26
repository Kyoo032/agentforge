import { z } from "zod";
import { ApiError } from "../../errors";
import { modeMessage } from "../../mode-messages";
import { defineTool } from "../define-tool";
import { resolveToolBackend } from "../credentials";
import { getSecret } from "../secret-scope";
import { currentKeylessLocale, searchKeyless } from "./keyless-search";

type SearchHit = { title: string; url: string; description: string; position: number };

async function searchTavily(
  query: string,
  apiKey: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<SearchHit[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Name": "agentforge",
    },
    body: JSON.stringify({ query, max_results: 5 }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError("tool_failed", body.error || `Tavily returned HTTP ${response.status}`, 502);
  }
  return (body.results ?? []).map((item, index) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    description: item.content ?? "",
    position: index + 1,
  }));
}

async function searchBrave(query: string, apiKey: string, fetchImpl: typeof fetch): Promise<SearchHit[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    message?: string;
  };
  if (!response.ok) {
    throw new ApiError("tool_failed", body.message || `Brave Search returned HTTP ${response.status}`, 502);
  }
  return (body.web?.results ?? []).map((item, index) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    description: item.description ?? "",
    position: index + 1,
  }));
}

export const webSearchTool = defineTool({
  key: "web_search",
  name: "Web search",
  description: "Search the public web. Returns titles, URLs, and snippets.",
  capability: "web",
  schema: z.object({
    query: z.string().min(1).describe("Search query"),
  }),
  execute: async ({ query }) => {
    const route = resolveToolBackend("web");
    // A chosen backend with no key stays an error. No choice and no key uses the keyless APIs.
    if (route.source === "selection" && !route.ready) {
      return {
        success: false,
        error: `Web search is set to ${route.backend} but that API key is missing. Add it in Settings.`,
      };
    }
    const fetchImpl = globalThis.fetch;
    if (route.ready && route.envVar) {
      const apiKey = getSecret(route.envVar);
      if (!apiKey) {
        return { success: false, error: `${route.envVar} is not set.` };
      }
      try {
        const hits =
          route.backend === "brave-free"
            ? await searchBrave(query, apiKey, fetchImpl)
            : await searchTavily(query, apiKey, route.baseUrl || "https://api.tavily.com", fetchImpl);
        return { success: true, backend: route.backend, data: { web: hits } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Web search failed" };
      }
    }
    try {
      const locale = currentKeylessLocale();
      const result = await searchKeyless(query, { fetchImpl, locale });
      if (result.outage) {
        return { success: false, error: modeMessage("webSearchFailed", locale) };
      }
      return { success: true, backend: "keyless", data: { web: result.hits } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : modeMessage("webSearchFailed", currentKeylessLocale()),
      };
    }
  },
});
