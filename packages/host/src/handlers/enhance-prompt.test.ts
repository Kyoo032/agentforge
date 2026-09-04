import { afterEach, describe, expect, it } from "vitest";
import { handlePostEnhancePrompt } from "./enhance-prompt";
import type { HostRequest } from "../types";

function request(body: unknown): HostRequest {
  return {
    method: "POST",
    path: "/api/v1/prompts/enhance",
    query: {},
    params: {},
    headers: {},
    body,
  };
}

describe("handlePostEnhancePrompt", () => {
  const previous = process.env.AGENTFORGE_RUNTIME;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.AGENTFORGE_RUNTIME;
    } else {
      process.env.AGENTFORGE_RUNTIME = previous;
    }
  });

  it("rejects empty input", async () => {
    process.env.AGENTFORGE_RUNTIME = "stub";
    const result = await handlePostEnhancePrompt(request({ text: "   " }));
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "empty_input" } });
  });

  it("rewrites locally on stub without a preface", async () => {
    process.env.AGENTFORGE_RUNTIME = "stub";
    const result = await handlePostEnhancePrompt(request({ text: "Summarize this memo.", surface: "documents" }));
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    const text = (result.body as { text?: string }).text ?? "";
    expect(text.length).toBeGreaterThan("Summarize this memo".length);
    expect(text).not.toMatch(/Enhanced prompt/i);
    expect(text.startsWith("Summarize this memo")).toBe(true);
  });
});
