import { z } from "zod";
import { HTML_TEXT_DEFAULT_MAX_CHARS, htmlToText, isHtmlContent, plainToText } from "../../content/html-text";
import { ApiError } from "../../errors";
import { fetchPublicHttps } from "../../security/safe-fetch";
import { defineTool } from "../define-tool";

export const WEB_FETCH_MAX_CHARS_CAP = 32_000;
export const WEB_FETCH_MAX_BYTES = 1_500_000;
export const WEB_FETCH_TIMEOUT_MS = 10_000;

const READABLE_TYPES =
  /^(text\/(html|plain|markdown|xml)|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json)|)$/i;

export type WebFetchPage = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  truncated: boolean;
  contentType: string;
};

export type WebFetchOutput = { success: true; data: WebFetchPage } | { success: false; error: string };

/** Read one public HTTPS page as text. Shared by the research reader and the agent tool. */
export async function fetchPageText(
  url: string,
  options: { maxChars?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<WebFetchPage> {
  const maxChars = Math.min(options.maxChars ?? HTML_TEXT_DEFAULT_MAX_CHARS, WEB_FETCH_MAX_CHARS_CAP);
  const result = await fetchPublicHttps(url, {
    maxBytes: WEB_FETCH_MAX_BYTES,
    timeoutMs: WEB_FETCH_TIMEOUT_MS,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    headers: { Accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.5" },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError("tool_failed", `Page returned HTTP ${result.status}`, 502);
  }
  const contentType = result.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!READABLE_TYPES.test(contentType)) {
    throw new ApiError("tool_failed", `Page is not readable text (${contentType || "unknown type"})`, 415);
  }
  const body = result.body.toString("utf8");
  const page = isHtmlContent(contentType, body) ? htmlToText(body, { maxChars }) : plainToText(body, { maxChars });
  if (!page.text) {
    throw new ApiError("tool_failed", "Page had no readable text", 422);
  }
  return { url, finalUrl: result.finalUrl, title: page.title, text: page.text, truncated: page.truncated, contentType };
}

export const webFetchTool = defineTool({
  key: "web_fetch",
  name: "Web fetch",
  description: "Read a public HTTPS web page as plain text (title + body, capped). No local or private addresses.",
  schema: z.object({
    url: z.string().min(1).describe("Absolute https:// URL"),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(WEB_FETCH_MAX_CHARS_CAP)
      .optional()
      .describe("Cap on returned characters"),
  }),
  execute: async ({ url, maxChars }): Promise<WebFetchOutput> => {
    try {
      return { success: true, data: await fetchPageText(url, { maxChars }) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Web fetch failed" };
    }
  },
});
