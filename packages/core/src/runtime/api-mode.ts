/**
 * Wire-protocol picks stripped from Hermes (Copilot/OpenCode rule +
 * host-mandated Responses on official OpenAI) and Pi (`api: openai-responses`
 * for GPT-5 / o-series). Some OpenAI-compatible gateways 400 GPT-5.6 + tools on
 * /v1/chat/completions and tell the client to use /v1/responses.
 */

export type OpenAiWire = "responses" | "chat_completions";

function bareModelId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function usesResponsesApi(modelId: string): boolean {
  const id = bareModelId(modelId);
  if (/^o[1-4]/.test(id)) {
    return true;
  }
  const gpt = id.match(/^gpt-(\d+)/);
  if (!gpt) {
    return false;
  }
  const major = Number(gpt[1]);
  return major >= 5 && !id.startsWith("gpt-5-mini");
}

export function preferredOpenAiWire(modelId: string): OpenAiWire {
  return usesResponsesApi(modelId) ? "responses" : "chat_completions";
}

export function shouldUpgradeToResponses(message: string): boolean {
  return /use \/v1\/responses|function tools with reasoning_effort/i.test(message);
}

export function shouldFallbackFromResponses(message: string): boolean {
  return (
    /(404|not found|unknown url|does not exist|no such endpoint)/i.test(message) ||
    /invalid url.*responses/i.test(message) ||
    /invalid schema for function/i.test(message)
  );
}

/**
 * Hermes Responses tools send `strict: false`. AI SDK 4 defaults
 * `strictSchemas` to true, which some OpenAI-compatible gateways then reject unless every
 * JSON-schema property is listed in `required`.
 */
export function openaiCompatProviderOptions(options: {
  responses?: boolean;
  forceReasoningNone?: boolean;
}): { openai: Record<string, string | boolean> } | undefined {
  if (!options.responses && !options.forceReasoningNone) {
    return undefined;
  }
  return {
    openai: {
      strictSchemas: false,
      ...(options.forceReasoningNone
        ? { reasoningEffort: "none" }
        : {
            reasoningEffort: "low",
            reasoningSummary: "auto",
          }),
    },
  };
}
