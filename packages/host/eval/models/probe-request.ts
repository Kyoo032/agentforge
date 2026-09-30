import {
  applyAnthropicMessagesBody,
  applyGeminiGenerateContentBody,
  geminiGenerateContentBaseUrl,
  toWireReasoningEffort,
  type ReasoningEffort,
  type ResolvedChatWire,
} from "@agentforge/core";
import { applyReasoningEffortToChatBody, applyReasoningToResponsesBody } from "@agentforge/core/reasoning-effort";

/** The one tiny prompt: any model that answers at all can answer it, and the answer is one word. */
export const PROBE_PROMPT = "Reply with the single word OK.";

/** What a chat-completions output budget is called. An OpenAI reasoning model wants the second. */
export type TokenField = "max_tokens" | "max_completion_tokens";

export type ProbeRequestInput = {
  model: string;
  wire: ResolvedChatWire;
  baseUrl: string;
  /** The level to send, or undefined for no effort parameter at all (the baseline). */
  level: ReasoningEffort | undefined;
  maxTokens: number;
  tokenField?: TokenField;
};

export type ProbeRequest = {
  model: string;
  url: string;
  /** No credential: the sender adds the key's header, so a request record can be stored as it is. */
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** The effort field as it was written, for the trace: never the body, which is not stored. */
  sends: string;
  wire: ResolvedChatWire;
  level: ReasoningEffort | undefined;
  maxTokens: number;
  tokenField: TokenField;
};

const HEADERS = Object.freeze({ "Content-Type": "application/json", Accept: "text/event-stream" });

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * One request per wire, the body the runtime itself writes (the same helpers) with two differences: the
 * level goes on the wire exactly as asked, with no snapping to what the policy table allows (finding out
 * what the gateway accepts is the point), and the output budget is small.
 */
export function buildProbeRequest(input: ProbeRequestInput): ProbeRequest {
  const tokenField = input.tokenField ?? "max_tokens";
  const base = trimSlashes(input.baseUrl);
  const shared = {
    model: input.model,
    wire: input.wire,
    level: input.level,
    maxTokens: input.maxTokens,
    tokenField,
    headers: { ...HEADERS },
  };

  if (input.wire === "responses") {
    const plain = {
      model: input.model,
      input: [{ role: "user", content: [{ type: "input_text", text: PROBE_PROMPT }] }],
      max_output_tokens: input.maxTokens,
      stream: true,
      store: false,
    };
    const body =
      input.level === undefined
        ? plain
        : (applyReasoningToResponsesBody(plain, toWireReasoningEffort(input.level, { responses: true })) as Record<string, unknown>);
    return {
      ...shared,
      url: `${base}/responses`,
      body,
      sends: input.level === undefined ? "no effort parameter" : `reasoning.effort=${input.level}`,
    };
  }

  if (input.wire === "anthropic_messages") {
    const plain = {
      model: input.model,
      messages: [{ role: "user", content: [{ type: "text", text: PROBE_PROMPT }] }],
      stream: true,
    };
    // The runtime's body helper pins max_tokens to 16 384; a probe wants its own small budget back.
    const applied = applyAnthropicMessagesBody(plain, input.level) as Record<string, unknown>;
    const sends =
      input.level === undefined
        ? "no effort parameter"
        : input.level === "none"
          ? "thinking=disabled"
          : `thinking=adaptive output_config.effort=${(applied.output_config as { effort?: string } | undefined)?.effort}`;
    return { ...shared, url: `${base}/messages`, body: { ...applied, max_tokens: input.maxTokens }, sends };
  }

  if (input.wire === "google_generate_content") {
    const plain = {
      contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
      generationConfig: { maxOutputTokens: input.maxTokens },
    };
    const body = applyGeminiGenerateContentBody(plain, input.level) as Record<string, unknown>;
    const budget = (body.generationConfig as { thinkingConfig?: { thinkingBudget?: number } } | undefined)?.thinkingConfig
      ?.thinkingBudget;
    return {
      ...shared,
      url: `${geminiGenerateContentBaseUrl(base)}/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`,
      body,
      sends: budget === undefined ? "no effort parameter" : `thinkingConfig.thinkingBudget=${budget}`,
    };
  }

  const plain = {
    model: input.model,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    [tokenField]: input.maxTokens,
    stream: true,
  };
  const body =
    input.level === undefined
      ? plain
      : (applyReasoningEffortToChatBody(plain, toWireReasoningEffort(input.level, {})) as Record<string, unknown>);
  return {
    ...shared,
    url: `${base}/chat/completions`,
    body,
    sends: input.level === undefined ? "no effort parameter" : `reasoning_effort=${input.level}`,
  };
}
