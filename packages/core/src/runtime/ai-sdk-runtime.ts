import { streamText, tool as aiTool, type CoreMessage, type UserContent } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ContentPart } from "../content/types";
import { getTool } from "../tools/registry";
import { resolveModelProvider } from "../models/catalog";
import { DEFAULT_OPENAI_BASE_URL, isOfficialOpenAIBaseUrl } from "../models/probe";
import { isOpenRouterBaseUrl } from "../privacy/openrouter";
import { getDisabledTools } from "../tools/secret-scope";
import { mapStreamPart } from "./stream-parts";
import { invokeToolGuarded } from "./invoke-guarded";
import {
  MODEL_CONTACT_ATTEMPTS,
  formatContactProbe,
  formatModelContactError,
  isRetryableModelFailure,
  shouldFailEmptyAssistant,
  shouldKeepToolTurn,
  shouldRetryModelContact,
  shouldRetryWithoutTools,
} from "./retry";
import { openaiCompatProviderOptions } from "./api-mode";
import {
  applyAnthropicMessagesBody,
  isMissingWireEndpoint,
  resolveChatWire,
  type ChatWire,
  type ResolvedChatWire,
} from "./chat-wire";
import { applyMinimaxRequest, isMinimaxChatModel, wrapMinimaxResponse } from "./minimax-compat";
import {
  applyReasoningEffortToChatBody,
  coerceReasoningEffortForModel,
  isChatCompletionsUrl,
  resolveRequestReasoningEffort,
  toWireReasoningEffort,
} from "../models/reasoning-effort";
import type { ReasoningEffort } from "../models/reasoning-effort";
import { abortErrorMessage, armStreamWatchdog, watchAsyncIterable } from "./stream-watchdog";
import { readLanguageModelUsage, addTokenUsage } from "../gateway/account";
import type { AgentRuntime, RunUsage } from "./types";
import {
  imagePartForProvider,
  rewriteUnreachableMediaInJson,
  scrubUnreachableMediaArgs,
} from "../content/provider-media";
import {
  applyZeroRetention,
  parseGatewayHttpError,
  readHttpErrorBody,
  sanitizeGatewayRequestBody,
} from "../models/request-constraints";

/**
 * Merges `provider.zdr = true` into the request body for OpenRouter endpoints.
 * Returns the original body reference unchanged for all other providers.
 * Exported for unit testing without requiring the live AI SDK.
 */
export function mergeOpenRouterZdr(body: unknown, baseUrl: string): unknown {
  if (!isOpenRouterBaseUrl(baseUrl)) {
    return body;
  }
  if (typeof body !== "object" || body === null) {
    return body;
  }
  const b = body as Record<string, unknown>;
  const existingProvider = typeof b["provider"] === "object" && b["provider"] !== null
    ? (b["provider"] as Record<string, unknown>)
    : {};
  return { ...b, provider: { ...existingProvider, zdr: true } };
}

function toCoreMessages(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }>,
): CoreMessage[] {
  const messages: CoreMessage[] = [{ role: "system", content: systemPrompt }];
  for (const item of history) {
    if (item.role === "assistant") {
      const text = item.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      messages.push({ role: "assistant", content: text });
      continue;
    }
    const content: UserContent = item.parts.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }
      if (part.type === "image_url") {
        return imagePartForProvider(part.image_url.url);
      }
      return {
        type: "text" as const,
        text: "[Video attached in the local app. It is already shown to the user.]",
      };
    });
    messages.push({ role: "user", content });
  }
  return messages;
}

const USAGE_SETTLE_MS = 5_000;
/** Response headers must arrive within this; a black-holed gateway otherwise sits until the 120 s watchdog. */
const HEADERS_TIMEOUT_MS = 10_000;

async function fetchWithHeaderTimeout(url: string | URL | Request, init: RequestInit): Promise<Response> {
  const headers = new AbortController();
  const timer = setTimeout(
    () => headers.abort(new Error(`Gateway unreachable: no response within ${HEADERS_TIMEOUT_MS / 1000}s`)),
    HEADERS_TIMEOUT_MS,
  );
  const signals = [headers.signal, init.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  try {
    // Only header arrival is bounded here; once the response resolves the timer is cleared and the
    // body stream stays under the runtime's own idle watchdog.
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("usage did not settle")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class AiSdkRuntime implements AgentRuntime {
  constructor(
    private readonly keys: {
      openai?: string;
      google?: string;
      anthropic?: string;
      volcengine?: string;
      openaiBaseUrl?: string;
      googleBaseUrl?: string;
      anthropicBaseUrl?: string;
      volcengineBaseUrl?: string;
    } = {},
  ) {}

  async execute(input: Parameters<AgentRuntime["execute"]>[0]): Promise<void> {
    const openaiKey = this.keys.openai ?? process.env.OPENAI_API_KEY;
    const googleKey = this.keys.google ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const anthropicKey = this.keys.anthropic ?? process.env.ANTHROPIC_API_KEY;
    const volcengineKey = this.keys.volcengine ?? process.env.ARK_API_KEY;
    const openaiBaseUrl = this.keys.openaiBaseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL;
    const googleBaseUrl = this.keys.googleBaseUrl ?? process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
    const anthropicBaseUrl = this.keys.anthropicBaseUrl ?? process.env.ANTHROPIC_BASE_URL;
    const volcengineBaseUrl = this.keys.volcengineBaseUrl ?? process.env.ARK_BASE_URL;
    const modelName = input.version.model;
    const provider = resolveModelProvider(modelName);

    const openaiLooksCustom = !isOfficialOpenAIBaseUrl(openaiBaseUrl);
    const requestedWire: ChatWire = input.wire ?? "auto";
    const resolvedWire = resolveChatWire(requestedWire, modelName);

    if (provider === "google" && googleKey) {
      const google = createGoogleGenerativeAI({
        apiKey: googleKey,
        ...(googleBaseUrl ? { baseURL: googleBaseUrl } : {}),
      });
      await this.stream(google(modelName), input);
      return;
    }

    // Parked extras Anthropic (unexposed GTM). Claude 5 auto uses the gateway Messages path.
    if (
      requestedWire === "auto" &&
      resolvedWire !== "anthropic_messages" &&
      provider === "anthropic" &&
      anthropicKey
    ) {
      const anthropic = createAnthropic({
        apiKey: anthropicKey,
        ...(anthropicBaseUrl ? { baseURL: anthropicBaseUrl } : {}),
      });
      await this.stream(anthropic(modelName, { sendReasoning: true }), input);
      return;
    }

    if (provider === "volcengine" && (volcengineKey || volcengineBaseUrl)) {
      const ark = createOpenAI({
        apiKey: volcengineKey || "ark",
        baseURL: volcengineBaseUrl || "https://ark.cn-beijing.volces.com/api/v3",
        compatibility: "compatible",
      });
      await this.stream(ark(modelName), input);
      return;
    }

    if (provider === "google" && !googleKey && !openaiLooksCustom) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini models");
    }
    if (provider === "anthropic" && !anthropicKey && !openaiLooksCustom) {
      throw new Error("ANTHROPIC_API_KEY is required for Claude models");
    }
    if (provider === "volcengine" && !volcengineKey && !volcengineBaseUrl && !openaiLooksCustom) {
      throw new Error("ARK_API_KEY is required for Volcengine models");
    }

    if (!openaiKey && !openaiBaseUrl) {
      throw new Error("OPENAI_API_KEY is required");
    }

    const zdrBaseUrl = openaiBaseUrl;
    const rawEffort = resolveRequestReasoningEffort(input);
    // GPT-5.6 none→low is completions/responses-only, not Messages.
    const openaiEffort = coerceReasoningEffortForModel(modelName, rawEffort);
    const wireEffort = toWireReasoningEffort(openaiEffort);
    const wrappedFetch: typeof fetch = async (url, init) => {
      let outgoing: RequestInit = (init as RequestInit) ?? {};
      let minimax = isMinimaxChatModel(modelName);
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body) as unknown;
          const scrubbed = rewriteUnreachableMediaInJson(parsed);
          const retained = applyZeroRetention(scrubbed, zdrBaseUrl);
          const withZdr = mergeOpenRouterZdr(retained, zdrBaseUrl);
          const minimaxBody = applyMinimaxRequest(withZdr);
          const withEffort = isChatCompletionsUrl(url)
            ? applyReasoningEffortToChatBody(minimaxBody, wireEffort)
            : minimaxBody;
          const bodyModel =
            typeof (withEffort as { model?: unknown }).model === "string"
              ? ((withEffort as { model: string }).model)
              : modelName;
          minimax = minimax || isMinimaxChatModel(bodyModel);
          const sanitized = sanitizeGatewayRequestBody(withEffort, bodyModel, url);
          outgoing = { ...init, body: JSON.stringify(sanitized) };
        } catch {
          // fall through to unmodified request on parse error
        }
      }
      const response = await fetchWithHeaderTimeout(url, outgoing);
      if (!response.ok) {
        const text = await readHttpErrorBody(response);
        throw new Error(parseGatewayHttpError(response.status, text));
      }
      return minimax ? wrapMinimaxResponse(response) : response;
    };

    const openai = createOpenAI({
      apiKey: openaiKey || "ollama",
      baseURL: openaiBaseUrl,
      compatibility: isOfficialOpenAIBaseUrl(openaiBaseUrl) ? "strict" : "compatible",
      fetch: wrappedFetch,
    });
    const chatModel = openai(modelName);
    const responsesModel = openai.responses(modelName);
    const openaiWire = {
      requested: requestedWire,
      wire: resolvedWire,
      chatModel,
      responsesModel,
    };

    if (resolvedWire === "anthropic_messages") {
      const messagesFetch: typeof fetch = async (url, init) => {
        let outgoing: RequestInit = (init as RequestInit) ?? {};
        if (init?.body && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as unknown;
            const scrubbed = rewriteUnreachableMediaInJson(parsed);
            const withThinking = applyAnthropicMessagesBody(scrubbed, rawEffort);
            const bodyModel =
              typeof (withThinking as { model?: unknown }).model === "string"
                ? ((withThinking as { model: string }).model)
                : modelName;
            const sanitized = sanitizeGatewayRequestBody(withThinking, bodyModel, url);
            outgoing = { ...init, body: JSON.stringify(sanitized) };
          } catch {
            // fall through to unmodified request on parse error
          }
        }
        const response = await fetchWithHeaderTimeout(url, outgoing);
        if (!response.ok) {
          const text = await readHttpErrorBody(response);
          throw new Error(parseGatewayHttpError(response.status, text));
        }
        return response;
      };
      const anthropic = createAnthropic({
        apiKey: openaiKey || "ollama",
        baseURL: openaiBaseUrl,
        fetch: messagesFetch,
      });
      await this.stream(anthropic(modelName, { sendReasoning: true }), input, openaiWire);
      return;
    }

    await this.stream(resolvedWire === "responses" ? responsesModel : chatModel, input, openaiWire);
  }

  private async stream(
    model: Parameters<typeof streamText>[0]["model"],
    input: Parameters<AgentRuntime["execute"]>[0],
    openaiWire?: {
      requested: ChatWire;
      wire: ResolvedChatWire;
      chatModel: Parameters<typeof streamText>[0]["model"];
      responsesModel: Parameters<typeof streamText>[0]["model"];
    },
  ): Promise<void> {
    const disabled = new Set(getDisabledTools());
    const tools: Record<string, any> = {};
    for (const binding of input.bindings.filter((item) => item.enabled)) {
      if (disabled.has(binding.toolKey)) {
        continue;
      }
      const definition = getTool(binding.toolKey);
      if (!definition) {
        continue;
      }
      tools[binding.toolKey] = aiTool({
        description: definition.description,
        parameters: definition.schema,
        execute: async (args: unknown) =>
          invokeToolGuarded(definition, scrubUnreachableMediaArgs(args), input.tenant),
      });
    }

    const messages = toCoreMessages(input.version.systemPrompt, input.history);
    const hasTools = Object.keys(tools).length > 0;
    const rawEffort = resolveRequestReasoningEffort(input);
    const openaiEffort = coerceReasoningEffortForModel(input.version.model, rawEffort);
    let activeModel = model;
    let wire = openaiWire?.wire;
    const effortForWire = (next: ResolvedChatWire | undefined) =>
      next === "anthropic_messages" ? rawEffort : openaiEffort;
    const wantThinking = effortForWire(wire) !== "none";
    const consumeOnce = (
      nextModel: Parameters<typeof streamText>[0]["model"],
      nextTools: Record<string, any> | undefined,
      options: {
        responses?: boolean;
        messages?: boolean;
        forceReasoningNone?: boolean;
        reasoningEffort?: ReasoningEffort;
      } = {},
    ) =>
      this.consumeSafe(nextModel, input, messages, nextTools, {
        ...options,
        reasoningEffort: options.reasoningEffort ?? effortForWire(wire),
      });

    const probe = async (attempt: number) => {
      await input.onEvent({
        type: "run.probing",
        model: input.version.model,
        attempt,
        attempts: MODEL_CONTACT_ATTEMPTS,
        message: formatContactProbe(input.version.model, attempt),
      });
    };

    await probe(1);
    let first = await consumeOnce(activeModel, hasTools ? tools : undefined, {
      responses: wire === "responses",
      messages: wire === "anthropic_messages",
      forceReasoningNone: !wantThinking,
    });

    if (
      first.failed &&
      openaiWire &&
      wire !== "chat_completions" &&
      isMissingWireEndpoint(first.failed)
    ) {
      activeModel = openaiWire.chatModel;
      wire = "chat_completions";
      first = await consumeOnce(activeModel, hasTools ? tools : undefined, {
        responses: false,
        forceReasoningNone: !wantThinking,
      });
    }

    const shouldRetryBare = shouldRetryWithoutTools({
      hasTools,
      text: first.text,
      failed: first.failed,
      tooled: first.tooled,
    });
    let result = shouldRetryBare
      ? await consumeOnce(activeModel, undefined, {
          responses: wire === "responses",
          messages: wire === "anthropic_messages",
        })
      : first;
    let contactAttempts = 1;
    const retryTools = shouldRetryBare ? undefined : hasTools ? tools : undefined;
    while (
      shouldRetryModelContact({
        failed: result.failed || (shouldFailEmptyAssistant({
          text: result.text,
          thinking: Boolean(result.thinking),
          tooled: result.tooled,
        })
          ? "The model returned no text"
          : ""),
        text: result.text,
        tooled: result.tooled,
        attempts: contactAttempts,
      })
    ) {
      contactAttempts += 1;
      await probe(contactAttempts);
      result = await consumeOnce(activeModel, retryTools, {
        responses: wire === "responses",
        messages: wire === "anthropic_messages",
        forceReasoningNone: Boolean(retryTools) && !wantThinking,
      });
    }
    const usage = addTokenUsage(first.usage, result === first ? { inputTokens: 0, outputTokens: 0 } : result.usage);
    const completedUsage: RunUsage | undefined =
      usage.inputTokens > 0 || usage.outputTokens > 0
        ? { model: input.version.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        : undefined;

    if (result.failed) {
      if (shouldKeepToolTurn({ tooled: result.toolCompleted, failed: result.failed })) {
        await input.onEvent({ type: "run.completed", runId: input.runId, usage: completedUsage });
        return;
      }
      const message = isRetryableModelFailure(result.failed)
        ? formatModelContactError(input.version.model, contactAttempts, result.failed)
        : result.failed;
      await input.onEvent({ type: "run.failed", message });
      throw new Error(message);
    }
    // Tool-only or thinking-only success must still complete so the transcript persists.
    if (shouldFailEmptyAssistant({ text: result.text, thinking: Boolean(result.thinking), tooled: result.tooled })) {
      const message = formatModelContactError(
        input.version.model,
        contactAttempts,
        "The model returned no text. Try another model, or turn off tools if this endpoint rejects them.",
      );
      await input.onEvent({ type: "run.failed", message });
      throw new Error(message);
    }
    await input.onEvent({ type: "run.completed", runId: input.runId, usage: completedUsage });
  }

  private async consumeSafe(
    model: Parameters<typeof streamText>[0]["model"],
    input: Parameters<AgentRuntime["execute"]>[0],
    messages: CoreMessage[],
    tools: Record<string, any> | undefined,
    options: {
      responses?: boolean;
      messages?: boolean;
      forceReasoningNone?: boolean;
      reasoningEffort?: ReasoningEffort;
    } = {},
  ) {
    try {
      return await this.consume(model, input, messages, tools, options);
    } catch (error) {
      return {
        text: false,
        thinking: "",
        tooled: false,
        toolCompleted: false,
        failed: error instanceof Error && error.message.trim() ? error.message : "The model could not be contacted.",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  private async consume(
    model: Parameters<typeof streamText>[0]["model"],
    input: Parameters<AgentRuntime["execute"]>[0],
    messages: CoreMessage[],
    tools: Record<string, any> | undefined,
    options: {
      responses?: boolean;
      messages?: boolean;
      forceReasoningNone?: boolean;
      reasoningEffort?: ReasoningEffort;
    } = {},
  ): Promise<{
    text: boolean;
    thinking: string;
    tooled: boolean;
    toolCompleted: boolean;
    failed: string;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const officialOpenAI = isOfficialOpenAIBaseUrl(
      this.keys.openaiBaseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    );
    const providerOptions = options.messages
      ? undefined
      : openaiCompatProviderOptions({ ...options, officialOpenAI });
    const abort = new AbortController();
    const watchdog = armStreamWatchdog(input.version.model, abort, input.streamWatchdog);
    const result = streamText({
      model,
      messages,
      abortSignal: abort.signal,
      // The contact loop below already retries; SDK retries would triple every offline wait.
      maxRetries: 0,
      ...(tools ? { tools, maxSteps: 6 } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    });
    let text = false;
    let thinking = "";
    let tooled = false;
    let toolCompleted = false;
    let failed = "";
    let usage = { inputTokens: 0, outputTokens: 0 };

    try {
      for await (const part of watchAsyncIterable(result.fullStream, abort, () => watchdog.touch())) {
      const event = mapStreamPart(part);
      if (!event) {
        continue;
      }
        if (event.type === "run.failed") {
          failed = event.message;
          break;
        }
        if (event.type === "assistant.delta") {
          text = true;
        }
        if (event.type === "assistant.thinking") {
          thinking += event.text;
        }
        if (event.type === "tool.started") {
          tooled = true;
        }
        if (event.type === "tool.completed") {
          tooled = true;
          toolCompleted = true;
        }
        await input.onEvent(event);
      }

      if (!text && !failed) {
        const fallback = await result.text.catch(() => "");
        if (fallback && fallback.trim().length > 0) {
          text = true;
          await input.onEvent({ type: "assistant.delta", text: fallback });
        }
      }

      // After an `error` stream part the SDK's `usage` promise never settles (ai 4.3): a refused or
      // black-holed gateway used to sit here until the 120 s host watchdog. Skip it on failure and
      // never wait more than a few seconds for it otherwise.
      if (!failed) {
        try {
          usage = readLanguageModelUsage(await settleWithin(result.usage, USAGE_SETTLE_MS));
        } catch {
          usage = { inputTokens: 0, outputTokens: 0 };
        }
      }

      return { text, thinking, tooled, toolCompleted, failed, usage };
    } catch (error) {
      const message = abortErrorMessage(error);
      if (!failed) {
        failed = message;
      }
      return { text, thinking, tooled, toolCompleted, failed, usage };
    } finally {
      watchdog.close();
    }
  }
}
