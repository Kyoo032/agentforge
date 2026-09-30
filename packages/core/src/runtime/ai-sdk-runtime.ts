import { streamText, tool as aiTool, type CoreMessage, type UserContent } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ContentPart } from "../content/types";
import { getTool } from "../tools/registry";
import { resolveModelProvider } from "../models/catalog";
import { jobThinkingPlan } from "../models/job-thinking";
import { DEFAULT_OPENAI_BASE_URL, isOfficialOpenAIBaseUrl } from "../models/probe";
import { isOpenRouterBaseUrl } from "../privacy/openrouter";
import { getDisabledTools } from "../tools/secret-scope";
import { mapStreamPart } from "./stream-parts";
import { invokeToolGuarded } from "./invoke-guarded";
import {
  MODEL_CONTACT_ATTEMPTS,
  formatContactProbe,
  formatModelContactError,
  hasVisibleText,
  isRetryableModelFailure,
  shouldFailEmptyAssistant,
  shouldKeepToolTurn,
  shouldRetryModelContact,
  shouldRetryWithoutTools,
} from "./retry";
import { openaiCompatProviderOptions } from "./api-mode";
import {
  applyAnthropicMessagesBody,
  applyGeminiGenerateContentBody,
  geminiGenerateContentBaseUrl,
  isGeminiGenerateContentUrl,
  isMissingWireEndpoint,
  resolveChatWire,
  type ChatWire,
  type ResolvedChatWire,
} from "./chat-wire";
import { createEffortState, type EffortState } from "./effort-plan";
import type { GatewayFailureDetail } from "./effort-selfheal";
import { applyMinimaxRequest, isMinimaxChatModel, wrapMinimaxResponse } from "./minimax-compat";
import {
  applyReasoningEffortToChatBody,
  applyReasoningToResponsesBody,
  isChatCompletionsUrl,
  isReasoningEffortExplicit,
  resolveRequestReasoningEffort,
  toWireReasoningEffort,
  withoutReasoningEffort,
} from "../models/reasoning-effort";
import type { ReasoningEffort } from "../models/reasoning-effort";
import { parseAppLocale } from "../locale";
import { providerEnv } from "../server-mode";
import { redactSecrets } from "../security/redact";
import { GatewayHttpError, gatewayFailureOf, gatewayHttpFailure } from "../gateway-http-copy";
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
  isResponsesRequestUrl,
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

/**
 * Forward the caller's cancel into one call's own controller, which the SDK request and the stream
 * reader already listen to. Returns the unlink; a caller with no signal links nothing.
 */
function linkCallerAbort(abort: AbortController, signal: AbortSignal | undefined): () => void {
  if (!signal) {
    return () => {};
  }
  const forward = () => abort.abort(signal.reason);
  if (signal.aborted) {
    forward();
    return () => {};
  }
  signal.addEventListener("abort", forward, { once: true });
  return () => signal.removeEventListener("abort", forward);
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
    // A caller that already left never starts the paid call.
    input.signal?.throwIfAborted();
    // Phase 4 — `this.keys` is the tenant's own, already resolved by `resolveProviderKeys`. The env
    // fallback behind it is the operator's, so on a hosted box it is empty; see `providerEnv`.
    const env = providerEnv();
    const openaiKey = this.keys.openai ?? env.OPENAI_API_KEY;
    const googleKey = this.keys.google ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
    const anthropicKey = this.keys.anthropic ?? env.ANTHROPIC_API_KEY;
    const volcengineKey = this.keys.volcengine ?? env.ARK_API_KEY;
    const openaiBaseUrl = this.keys.openaiBaseUrl ?? env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL;
    const googleBaseUrl = this.keys.googleBaseUrl ?? env.GOOGLE_GENERATIVE_AI_BASE_URL;
    const anthropicBaseUrl = this.keys.anthropicBaseUrl ?? env.ANTHROPIC_BASE_URL;
    const volcengineBaseUrl = this.keys.volcengineBaseUrl ?? env.ARK_BASE_URL;
    const modelName = input.version.model;
    const runLocale = parseAppLocale(input.locale);
    // One place turns a gateway 4xx/5xx into words: app-locale headline, upstream text to the log.
    // The raw body rides on the error (never in its message) so the runtime can tell when the gateway
    // refused the Thinking parameter and retry with a safer one.
    const gatewayFailure = (status: number, text: string): Error => {
      const failure = gatewayHttpFailure(status, text, runLocale);
      if (failure.detail && failure.detail !== failure.message) {
        console.warn(`gateway: HTTP ${status} ${redactSecrets(failure.detail).slice(0, 300)}`);
      }
      return new GatewayHttpError(failure.message, status, text);
    };
    const provider = resolveModelProvider(modelName);

    const openaiLooksCustom = !isOfficialOpenAIBaseUrl(openaiBaseUrl);
    const officialOpenAI = isOfficialOpenAIBaseUrl(openaiBaseUrl);
    const requestedWire: ChatWire = input.wire ?? "auto";
    const resolvedWire = resolveChatWire(requestedWire, modelName);
    // A job on an always-thinking family asks it to think less; Chat sends no mode here. The level
    // goes through the same plan as any other, so a level the gateway refuses can step down and stay
    // down instead of the knob writing itself back over the plan on every request.
    const jobKnob = jobThinkingPlan(modelName, input.jobMode);
    // What the Thinking level of this run is on the wire, and how it backs off if the gateway refuses
    // it. One state for every request the run makes: the first try, a wire fallback, a retry.
    const effort = createEffortState({
      modelId: modelName,
      requested: jobKnob?.effort ?? resolveRequestReasoningEffort(input),
      explicit: jobKnob?.effort !== undefined || isReasoningEffortExplicit(input),
      wire: resolvedWire,
      officialOpenAI,
      // What a tenant's gateway key refused says nothing about another tenant's.
      scope: input.tenant.tenantId,
    });

    // Parked extras Google (unexposed GTM). Gemini chat auto uses gateway generateContent.
    if (
      requestedWire === "auto" &&
      resolvedWire !== "google_generate_content" &&
      provider === "google" &&
      googleKey
    ) {
      const google = createGoogleGenerativeAI({
        apiKey: googleKey,
        ...(googleBaseUrl ? { baseURL: googleBaseUrl } : {}),
      });
      await this.stream(google(modelName), input, effort);
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
      await this.stream(anthropic(modelName, { sendReasoning: true }), input, effort);
      return;
    }

    if (provider === "volcengine" && (volcengineKey || volcengineBaseUrl)) {
      const ark = createOpenAI({
        apiKey: volcengineKey || "ark",
        baseURL: volcengineBaseUrl || "https://ark.cn-beijing.volces.com/api/v3",
        compatibility: "compatible",
      });
      await this.stream(ark(modelName), input, effort);
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
          const level = effort.level();
          // Completions carry `reasoning_effort` (written here); Responses carry `reasoning.effort`,
          // which the AI SDK writes itself for `o*` and `gpt-5*` ids only — for any other id it left
          // the level out, so `applyReasoningToResponsesBody` adds the block when the SDK did not.
          const withEffort = isChatCompletionsUrl(url)
            ? level === undefined
              ? withoutReasoningEffort(minimaxBody)
              : applyReasoningEffortToChatBody(
                  minimaxBody,
                  toWireReasoningEffort(level, { officialOpenAI, responses: resolvedWire === "responses" }),
                )
            : isResponsesRequestUrl(url) && level !== undefined
              ? applyReasoningToResponsesBody(
                  minimaxBody,
                  toWireReasoningEffort(level, { officialOpenAI, responses: true }),
                )
              : minimaxBody;
          const bodyModel =
            typeof (withEffort as { model?: unknown }).model === "string"
              ? ((withEffort as { model: string }).model)
              : modelName;
          minimax = minimax || isMinimaxChatModel(bodyModel);
          // The rest of a job's knob (its level is already in the effort plan); Chat sends no mode here.
          const withJobThinking =
            isChatCompletionsUrl(url) && jobKnob && Object.keys(jobKnob.rest).length > 0
              ? { ...(withEffort as Record<string, unknown>), ...jobKnob.rest }
              : withEffort;
          const sanitized = sanitizeGatewayRequestBody(withJobThinking, bodyModel, url);
          outgoing = { ...init, body: JSON.stringify(sanitized) };
        } catch {
          // fall through to unmodified request on parse error
        }
      }
      const response = await fetchWithHeaderTimeout(url, outgoing);
      if (!response.ok) {
        const text = await readHttpErrorBody(response);
        throw gatewayFailure(response.status, text);
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
            const withThinking = applyAnthropicMessagesBody(scrubbed, effort.level());
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
          throw gatewayFailure(response.status, text);
        }
        return response;
      };
      const anthropic = createAnthropic({
        apiKey: openaiKey || "ollama",
        baseURL: openaiBaseUrl,
        fetch: messagesFetch,
      });
      await this.stream(anthropic(modelName, { sendReasoning: true }), input, effort, openaiWire);
      return;
    }

    if (resolvedWire === "google_generate_content") {
      const geminiFetch: typeof fetch = async (url, init) => {
        let outgoing: RequestInit = (init as RequestInit) ?? {};
        if (init?.body && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as unknown;
            const scrubbed = rewriteUnreachableMediaInJson(parsed);
            const withThinking = isGeminiGenerateContentUrl(url)
              ? applyGeminiGenerateContentBody(scrubbed, effort.level())
              : scrubbed;
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
          throw gatewayFailure(response.status, text);
        }
        return response;
      };
      const google = createGoogleGenerativeAI({
        apiKey: openaiKey || "ollama",
        baseURL: geminiGenerateContentBaseUrl(openaiBaseUrl),
        fetch: geminiFetch,
      });
      await this.stream(google(modelName), input, effort, openaiWire);
      return;
    }

    await this.stream(resolvedWire === "responses" ? responsesModel : chatModel, input, effort, openaiWire);
  }

  private async stream(
    model: Parameters<typeof streamText>[0]["model"],
    input: Parameters<AgentRuntime["execute"]>[0],
    effort: EffortState,
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
    let activeModel = model;
    let wire = openaiWire?.wire;
    // Read at each call, not once: a heal below changes what the run sends.
    const wantsThinking = () => effort.level() !== "none";
    const consumeOnce = async (
      nextModel: Parameters<typeof streamText>[0]["model"],
      nextTools: Record<string, any> | undefined,
      options: {
        responses?: boolean;
        messages?: boolean;
        google?: boolean;
        forceReasoningNone?: boolean;
      } = {},
    ) => {
      // Every call below goes through here: the first, the wire fallback, the tool-less retry and
      // the contact retries. A cancel starts none of them.
      input.signal?.throwIfAborted();
      const level = effort.level();
      const outcome = await this.consumeSafe(nextModel, input, messages, nextTools, {
        ...options,
        reasoningEffort: level,
        // No effort to send (an id the policy table does not know, or a parameter the gateway refused).
        omitReasoning: level === undefined,
      });
      if (outcome.failed) {
        // The call the cancel cut short is not a failure to retry or report: its abort message would
        // read as a network blip. A call that finished first is still completed, and metered, below.
        input.signal?.throwIfAborted();
      }
      return outcome;
    };

    const probe = async (attempt: number) => {
      await input.onEvent({
        type: "run.probing",
        model: input.version.model,
        attempt,
        attempts: MODEL_CONTACT_ATTEMPTS,
        message: formatContactProbe(
          input.version.model,
          attempt,
          MODEL_CONTACT_ATTEMPTS,
          parseAppLocale(input.locale),
        ),
      });
    };

    await probe(1);
    let first = await consumeOnce(activeModel, hasTools ? tools : undefined, {
      responses: wire === "responses",
      messages: wire === "anthropic_messages",
        google: wire === "google_generate_content",
      forceReasoningNone: !wantsThinking(),
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
        forceReasoningNone: !wantsThinking(),
      });
    }

    // The gateway refused the Thinking parameter before anything came back: one retry with a safer
    // shape. Never once a token, a thinking delta or a tool call has been produced — the retry would
    // repeat it — and never for any other failure. What the retry learns is kept per model.
    if (first.failure && !first.text && !first.tooled && !first.thinking) {
      if (effort.heal(first.failure, wire ?? "chat_completions")) {
        first = await consumeOnce(activeModel, hasTools ? tools : undefined, {
          responses: wire === "responses",
          messages: wire === "anthropic_messages",
          google: wire === "google_generate_content",
          forceReasoningNone: !wantsThinking(),
        });
        effort.settle(!first.failed);
      }
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
        google: wire === "google_generate_content",
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
        google: wire === "google_generate_content",
        forceReasoningNone: Boolean(retryTools) && !wantsThinking(),
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
        ? formatModelContactError(input.version.model, contactAttempts, result.failed, parseAppLocale(input.locale))
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
        parseAppLocale(input.locale),
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
      google?: boolean;
      forceReasoningNone?: boolean;
      reasoningEffort?: ReasoningEffort;
      omitReasoning?: boolean;
    } = {},
  ) {
    try {
      return await this.consume(model, input, messages, tools, options);
    } catch (error) {
      return {
        failure: gatewayFailureOf(error),
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
      google?: boolean;
      forceReasoningNone?: boolean;
      reasoningEffort?: ReasoningEffort;
      omitReasoning?: boolean;
    } = {},
  ): Promise<{
    text: boolean;
    thinking: string;
    tooled: boolean;
    toolCompleted: boolean;
    failed: string;
    /** Set when the failure was a gateway HTTP refusal: its status and raw body, for classification only. */
    failure?: GatewayFailureDetail | undefined;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const officialOpenAI = isOfficialOpenAIBaseUrl(
      this.keys.openaiBaseUrl ?? providerEnv().OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    );
    const providerOptions =
      options.messages || options.google
        ? undefined
        : openaiCompatProviderOptions({ ...options, officialOpenAI });
    const abort = new AbortController();
    // The caller's cancel aborts this request and wakes the stream reader, like a watchdog timeout.
    const unlinkCallerAbort = linkCallerAbort(abort, input.signal);
    const locale = parseAppLocale(input.locale);
    const watchdog = armStreamWatchdog(input.version.model, abort, input.streamWatchdog, Date.now, locale);
    const result = streamText({
      model,
      messages,
      abortSignal: abort.signal,
      // The contact loop below already retries; SDK retries would triple every offline wait.
      maxRetries: 0,
      ...(tools ? { tools, maxSteps: 6 } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    });
    // True once readable text has streamed. Whitespace is not text (`hasVisibleText`): a model that
    // answers HTTP 200 with a single space has said nothing, and the checks below (the tool-less retry,
    // the empty-reply failure) must see that, not "the first delta came".
    let text = false;
    // Whitespace-only deltas ahead of the first readable text. They are held back, so an attempt that
    // ends blank hands nothing on (a retry then cannot leave a stray blank in front of its answer, and a
    // host never persists one), and flushed in front of the first readable delta when one follows.
    let leadingBlank = "";
    let thinking = "";
    let tooled = false;
    let toolCompleted = false;
    let failed = "";
    let failure: GatewayFailureDetail | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };

    try {
      for await (const part of watchAsyncIterable(result.fullStream, abort, () => watchdog.touch(), locale)) {
        const event = mapStreamPart(part);
        if (!event) {
          continue;
        }
        // Only a mapped part is the model working. The SDK opens every stream with a `step-start`
        // as soon as the first frame lands, and counting that as a first token would hand a model
        // that is still thinking the short idle budget instead of the first-token one.
        watchdog.touchOutput();
        if (event.type === "run.failed") {
          failed = event.message;
          failure = gatewayFailureOf((part as { error?: unknown }).error);
          break;
        }
        let outgoing = event;
        if (event.type === "assistant.delta" && !text) {
          if (!hasVisibleText(event.text)) {
            leadingBlank += event.text;
            continue;
          }
          text = true;
          outgoing = leadingBlank ? { ...event, text: leadingBlank + event.text } : event;
          leadingBlank = "";
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
        await input.onEvent(outgoing);
      }

      if (!text && !failed) {
        const fallback = await result.text.catch(() => "");
        if (hasVisibleText(fallback)) {
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

      return { text, thinking, tooled, toolCompleted, failed, failure, usage };
    } catch (error) {
      const message = abortErrorMessage(error, locale);
      if (!failed) {
        failed = message;
        failure = gatewayFailureOf(error);
      }
      return { text, thinking, tooled, toolCompleted, failed, failure, usage };
    } finally {
      watchdog.close();
      unlinkCallerAbort();
    }
  }
}
