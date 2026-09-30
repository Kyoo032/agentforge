import { describe, expect, it } from "vitest";
import { PROBE_PROMPT, buildProbeRequest } from "./probe-request";

const BASE = "https://gateway.example.test/v1";

function build(wire: Parameters<typeof buildProbeRequest>[0]["wire"], level: Parameters<typeof buildProbeRequest>[0]["level"], extra = {}) {
  return buildProbeRequest({ model: "some-model", wire, baseUrl: BASE, level, maxTokens: 32, ...extra });
}

describe("PROBE_PROMPT", () => {
  it("is the one tiny prompt the brief asked for", () => {
    expect(PROBE_PROMPT).toBe("Reply with the single word OK.");
  });
});

describe("chat_completions", () => {
  it("posts the prompt, a small output budget, a stream, and the level as reasoning_effort", () => {
    const request = build("chat_completions", "high");
    expect(request.url).toBe(`${BASE}/chat/completions`);
    expect(request.body).toEqual({
      model: "some-model",
      messages: [{ role: "user", content: PROBE_PROMPT }],
      max_tokens: 32,
      stream: true,
      reasoning_effort: "high",
    });
    expect(request.sends).toBe("reasoning_effort=high");
  });

  it("sends Off as the level none, and passes Ultra through untouched", () => {
    expect(build("chat_completions", "none").body).toMatchObject({ reasoning_effort: "none" });
    expect(build("chat_completions", "ultra").body).toMatchObject({ reasoning_effort: "ultra" });
  });

  it("sends no effort parameter at all for the baseline", () => {
    const request = build("chat_completions", undefined);
    expect("reasoning_effort" in request.body).toBe(false);
    expect(request.sends).toBe("no effort parameter");
  });

  it("can name its output budget max_completion_tokens instead, the way an OpenAI reasoning model wants it", () => {
    const request = build("chat_completions", "low", { tokenField: "max_completion_tokens" });
    expect(request.body).toMatchObject({ max_completion_tokens: 32 });
    expect("max_tokens" in request.body).toBe(false);
  });
});

describe("responses", () => {
  it("posts input, the output budget, store false, and the reasoning block the runtime writes", () => {
    const request = build("responses", "high");
    expect(request.url).toBe(`${BASE}/responses`);
    expect(request.body).toEqual({
      model: "some-model",
      input: [{ role: "user", content: [{ type: "input_text", text: PROBE_PROMPT }] }],
      reasoning: { effort: "high", summary: "auto" },
      max_output_tokens: 32,
      stream: true,
      store: false,
    });
    expect(request.sends).toBe("reasoning.effort=high");
  });

  it("sends Off as effort none with no summary, as the runtime does", () => {
    expect(build("responses", "none").body).toMatchObject({ reasoning: { effort: "none" } });
  });

  it("sends no reasoning block for the baseline", () => {
    expect("reasoning" in build("responses", undefined).body).toBe(false);
  });
});

describe("anthropic_messages", () => {
  it("posts adaptive thinking and output_config.effort, and keeps the small output budget", () => {
    const request = build("anthropic_messages", "high");
    expect(request.url).toBe(`${BASE}/messages`);
    expect(request.body).toMatchObject({
      model: "some-model",
      messages: [{ role: "user", content: [{ type: "text", text: PROBE_PROMPT }] }],
      stream: true,
      max_tokens: 32,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    expect(request.sends).toBe("thinking=adaptive output_config.effort=high");
  });

  it("sends Off as thinking disabled, and Ultra as max", () => {
    const off = build("anthropic_messages", "none");
    expect(off.body).toMatchObject({ thinking: { type: "disabled" }, max_tokens: 32 });
    expect(off.sends).toBe("thinking=disabled");
    expect(build("anthropic_messages", "ultra").body).toMatchObject({ output_config: { effort: "max" } });
  });

  it("sends neither for the baseline", () => {
    const request = build("anthropic_messages", undefined);
    expect("thinking" in request.body).toBe(false);
    expect("output_config" in request.body).toBe(false);
    expect(request.body).toMatchObject({ max_tokens: 32 });
  });
});

describe("google_generate_content", () => {
  it("posts to the v1beta stream route with a thinking budget", () => {
    const request = build("google_generate_content", "high");
    expect(request.url).toBe("https://gateway.example.test/v1beta/models/some-model:streamGenerateContent?alt=sse");
    expect(request.body).toEqual({
      contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
      generationConfig: { maxOutputTokens: 32, thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } },
    });
    expect(request.sends).toBe("thinkingConfig.thinkingBudget=8192");
  });

  it("sends Off as a zero budget", () => {
    expect(build("google_generate_content", "none").body).toMatchObject({
      generationConfig: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
    });
  });

  it("sends no thinkingConfig for the baseline, and escapes the model id in the path", () => {
    const request = buildProbeRequest({
      model: "gemini/odd id",
      wire: "google_generate_content",
      baseUrl: BASE,
      level: undefined,
      maxTokens: 32,
    });
    expect(request.url).toContain("/models/gemini%2Fodd%20id:streamGenerateContent");
    expect(request.body).toEqual({
      contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
      generationConfig: { maxOutputTokens: 32 },
    });
  });
});

describe("every request", () => {
  it("carries no credential: the sender adds the key, the record never has it", () => {
    for (const wire of ["chat_completions", "responses", "anthropic_messages", "google_generate_content"] as const) {
      const request = build(wire, "medium");
      expect(Object.keys(request.headers).map((name) => name.toLowerCase())).toEqual(["content-type", "accept"]);
      expect(JSON.stringify(request)).not.toMatch(/authorization|api-key|bearer/i);
    }
  });

  it("does not mutate what it is given, and tolerates a base URL with a trailing slash", () => {
    const request = buildProbeRequest({ model: "m", wire: "responses", baseUrl: `${BASE}//`, level: "low", maxTokens: 16 });
    expect(request.url).toBe(`${BASE}/responses`);
    expect(request.maxTokens).toBe(16);
  });
});
