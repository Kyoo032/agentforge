import {
  assertAgentSupportsModality,
  assertModelSupportsModality,
  createRuntime,
  encodeSse,
  redactSecrets,
  isDefaultChatAgent,
  parseImageRunInput,
  parseTextRunInput,
  parseVideoRunInput,
  readOptionalModel,
  readOptionalThinking,
  resolveChatModel,
  hasModelVisibleContent,
  modelHistoryParts,
  redactAttachedParts,
  takeLastToolIo,
  resolvedGatewayBaseUrl,
  type ContentPart,
  type InputModality,
  type TenantContext,
  type ToolBindingRecord,
  type ToolCallPart,
} from "@agentforge/core";
import { ApiError } from "@agentforge/core";
import { agentService } from "./tenant";
import { knowledgeInjection } from "./knowledge";
import {
  finishRun,
  getThread,
  insertMessage,
  insertRun,
  insertToolInvocation,
  listMessages,
  setThreadTitleFromParts,
} from "./threads";
import { ensureToolsRegistered } from "./register-tools";
import { loadSettings } from "./settings-store";
import { defaultSelectableModel, listSelectableModels } from "./selectable-models";
import { collectToolMediaParts } from "./tool-media";
import { inlineLocalMediaParts, shouldInlineLocalMediaForProvider } from "./inline-local-media";
import { saveGeneratedImage } from "./media";
import { withRunContext } from "./run-context";
import { formatPastSessionsHint } from "./session-recall";

const parsers = {
  text: parseTextRunInput,
  image: parseImageRunInput,
  video: parseVideoRunInput,
} as const;

class StringQueue {
  private items: string[] = [];
  private waiters: Array<(next: IteratorResult<string>) => void> = [];
  private closed = false;

  push(item: string): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as unknown as string, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as string;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<string>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

function withPastSessionsBinding(bindings: ToolBindingRecord[]): ToolBindingRecord[] {
  if (bindings.some((binding) => binding.toolKey === "past_sessions" && binding.enabled)) {
    return bindings;
  }
  return [
    ...bindings,
    {
      id: "past-sessions-local",
      agentVersionId: bindings[0]?.agentVersionId ?? "",
      organizationId: bindings[0]?.organizationId ?? "",
      toolKey: "past_sessions",
      config: {},
      enabled: true,
    },
  ];
}

export async function* startModalityRun(options: {
  tenant: TenantContext;
  threadId: string;
  modality: InputModality;
  body: unknown;
}): AsyncIterable<string> {
  ensureToolsRegistered();
  const parsed = parsers[options.modality](options.body as { content?: unknown; stream?: unknown });
  const settings = loadSettings();
  const userParts =
    settings.injectionGuardBypass === true ? parsed.parts : redactAttachedParts(parsed.parts);
  const thinkingEnabled = readOptionalThinking(options.body);
  const thread = await getThread(options.tenant, options.threadId);
  if (!thread) {
    throw new ApiError("not_found", "Thread not found", 404);
  }
  const published = await agentService.getPublishedForRun(options.tenant, thread.agentId);
  const catalog = listSelectableModels();
  const fallback = isDefaultChatAgent(published.agent)
    ? defaultSelectableModel(catalog)
    : published.version.model;
  const model = resolveChatModel(readOptionalModel(options.body), fallback, catalog);
  const pastHint = await formatPastSessionsHint(options.tenant, thread.agentId, thread.id);
  const userText = userParts
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
  const knowledge = knowledgeInjection(options.tenant, userText);
  const version = {
    ...published.version,
    model,
    systemPrompt: published.version.systemPrompt + pastHint + knowledge.prompt,
  };
  assertAgentSupportsModality(published.version.inputModalities, options.modality);
  assertModelSupportsModality(version.model, options.modality);

  const queue = new StringQueue();
  const send = (event: Parameters<typeof encodeSse>[0]) => {
    queue.push(encodeSse(event));
  };
  queue.push(": connected\n\n");

  const work = (async () => {
    let assistantText = "";
    let thinkingText = "";
    let failedMessage = "";
    const mediaParts: ContentPart[] = [];
    const toolTrace: ToolCallPart[] = [];
    let runId: string | null = null;
    let persisted = false;
    let runUsage: Record<string, unknown> | null = null;
    const persistAssistant = async () => {
      const assistantParts: ContentPart[] = [];
      if (thinkingText.trim()) {
        assistantParts.push({ type: "thinking", text: thinkingText.trim() });
      }
      for (const tool of toolTrace) {
        assistantParts.push(tool);
      }
      if (assistantText.trim()) {
        assistantParts.push({ type: "text", text: assistantText.trim() });
      }
      assistantParts.push(...mediaParts);
      if (persisted) {
        return true;
      }
      if (assistantParts.length === 0) {
        return false;
      }
      await insertMessage(options.tenant, thread.id, "assistant", assistantParts);
      persisted = true;
      return true;
    };
    try {
      await insertMessage(options.tenant, thread.id, "user", userParts);
      await setThreadTitleFromParts(options.tenant, thread.id, userParts);
      const run = await insertRun(options.tenant, thread.id, published.version.id, options.modality);
      runId = run.id;
      const historyRows = await listMessages(options.tenant, thread.id);
      const inlineLocal = shouldInlineLocalMediaForProvider(settings.openaiBaseUrl || resolvedGatewayBaseUrl());
      const history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }> = [];
      for (const row of historyRows) {
        if (row.role !== "user" && row.role !== "assistant") {
          continue;
        }
        const parts = row.content as ContentPart[];
        if (row.role === "assistant" && !hasModelVisibleContent(parts)) {
          continue;
        }
        const historyParts = modelHistoryParts(parts);
        history.push({
          role: row.role as "user" | "assistant",
          parts:
            row.role === "user" && inlineLocal
              ? await inlineLocalMediaParts(options.tenant, historyParts)
              : historyParts,
        });
      }
      const runtime = createRuntime(settings);
      send({ type: "run.started", runId: run.id });

      await withRunContext({ threadId: thread.id, agentId: thread.agentId }, async () => {
        await runtime.execute({
          tenant: options.tenant,
          runId: run.id,
          modality: options.modality,
          version,
          bindings: withPastSessionsBinding(published.bindings),
          history,
          thinking: thinkingEnabled,
          onEvent: async (event) => {
            if (event.type === "run.failed") {
              failedMessage = redactSecrets(event.message);
              if (mediaParts.length === 0) {
                send({ ...event, message: failedMessage });
              }
              return;
            }
            if (event.type === "run.completed") {
              if (event.usage) {
                runUsage = event.usage;
              }
              await persistAssistant();
              send(event);
              return;
            }
            send(event);
            if (event.type === "assistant.delta") {
              assistantText += event.text;
            }
            if (event.type === "assistant.thinking") {
              thinkingText += event.text;
            }
            if (event.type === "tool.started") {
              toolTrace.push({
                type: "tool_call",
                toolKey: event.toolKey,
                status: "started",
                input: event.input,
              });
              await insertToolInvocation(options.tenant, run.id, event.toolKey, event.input, null, "started");
            }
            if (event.type === "tool.completed") {
              const recorded = takeLastToolIo(event.toolKey);
              const persistOutput = recorded?.full ?? event.output;
              const last = [...toolTrace].reverse().find((item) => item.toolKey === event.toolKey && item.status === "started");
              if (last) {
                last.status = "completed";
                last.output = event.output;
              } else {
                toolTrace.push({
                  type: "tool_call",
                  toolKey: event.toolKey,
                  status: "completed",
                  output: event.output,
                });
              }
              await insertToolInvocation(options.tenant, run.id, event.toolKey, null, persistOutput, "completed");
              for (const part of collectToolMediaParts(persistOutput)) {
                if (part.type === "image_url") {
                  const stored = await saveGeneratedImage(options.tenant, part.image_url.url);
                  mediaParts.push({ type: "image_url", image_url: { url: stored } });
                  continue;
                }
                mediaParts.push(part);
              }
            }
          },
        });
      });
      await persistAssistant();
      await finishRun(options.tenant, run.id, "completed", undefined, runUsage);
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : "run_failed");
      const saved = await persistAssistant();
      if (runId) {
        await finishRun(
          options.tenant,
          runId,
          saved ? "completed" : "failed",
          saved ? undefined : message,
          runUsage,
        );
      }
      if (!saved && !failedMessage) {
        send({ type: "run.failed", message });
      }
      send({ type: "run.completed", runId: runId ?? "unknown" });
    } finally {
      queue.close();
    }
  })();

  try {
    yield* queue;
  } finally {
    await work;
  }
}
