import {
  assertAgentSupportsModality,
  assertModelSupportsModality,
  createRuntime,
  encodeSse,
  redactSecrets,
  abortErrorMessage,
  isDefaultChatAgent,
  parseImageRunInput,
  parseTextRunInput,
  parseVideoRunInput,
  readOptionalModel,
  readOptionalReasoningEffort,
  readOptionalChatWire,
  resolveChatModel,
  hasModelVisibleContent,
  modelHistoryParts,
  redactAttachedParts,
  takeLastToolIo,
  resolvedGatewayBaseUrl,
  resolveProviderKeys,
  type ContentPart,
  type InputModality,
  type TenantContext,
  type ToolBindingRecord,
  type ToolCallPart,
  withChatOutputLanguage,
} from "@agentforge/core";
import { ApiError } from "@agentforge/core";
import { agentService } from "./tenant";
import { armRunStallGuard, isRunOutputEvent } from "./run-stall";
import { knowledgeInjection } from "./knowledge";
import { citedSources } from "./knowledge-cites";
import { recordCites } from "./knowledge-graph";
import { recordRetrievals, recordsRetrievals } from "./knowledge-retrievals";
import { ingestWorkSource } from "./knowledge-ingest";
import { chatWorkCard } from "./work-cards";
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
import { saveGeneratedImage, saveGeneratedVideo } from "./media";
import { withRunContext } from "./run-context";
import { getBootLocale } from "./locale-boot";
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
  abortSignal?: AbortSignal;
}): AsyncIterable<string> {
  ensureToolsRegistered();
  const parsed = parsers[options.modality](options.body as { content?: unknown; stream?: unknown });
  const settings = loadSettings(options.tenant.workspaceId);
  const userParts = settings.injectionGuardBypass === true ? parsed.parts : redactAttachedParts(parsed.parts);
  const reasoningEffort = readOptionalReasoningEffort(options.body);
  const thinkingEnabled = reasoningEffort !== "none";
  const wire = readOptionalChatWire(options.body);
  const thread = await getThread(options.tenant, options.threadId);
  if (!thread) {
    throw new ApiError("not_found", "Thread not found", 404);
  }
  const published = await agentService.getPublishedForRun(options.tenant, thread.agentId);
  const catalog = listSelectableModels();
  const fallback = isDefaultChatAgent(published.agent) ? defaultSelectableModel(catalog) : published.version.model;
  const requestedModel = readOptionalModel(options.body);
  const model = resolveChatModel(requestedModel, fallback, catalog);
  const pastHint = await formatPastSessionsHint(options.tenant, thread.agentId, thread.id);
  const userText = userParts
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
  // The thread's own work card is skipped so Chat never retrieves its last reply back into itself.
  const knowledge = await knowledgeInjection(options.tenant, userText, { excludeThreadId: thread.id });
  const locale = getBootLocale();
  const version = {
    ...published.version,
    model,
    systemPrompt: withChatOutputLanguage(published.version.systemPrompt + pastHint + knowledge.prompt, locale),
  };
  assertAgentSupportsModality(published.version.inputModalities, options.modality);
  assertModelSupportsModality(version.model, options.modality);

  const queue = new StringQueue();
  let queueClosed = false;
  const closeQueue = () => {
    queueClosed = true;
    queue.close();
  };
  const send = (event: Parameters<typeof encodeSse>[0]) => {
    queue.push(encodeSse(event));
  };
  queue.push(": connected\n\n");
  // Shared with `work` so the watchdog / client-abort paths can finalize the run row. Without this a
  // run whose model call never answers stays `streaming` forever (observed under a hung gateway).
  let runId: string | null = null;
  // True once the watchdog or a client abort reported failure. The user has seen `run.failed`, so a
  // model answer that arrives later is dropped instead of being persisted as a completed turn.
  let settled = false;
  let settledMessage = "";
  const settleRun = (message: string) => {
    settled = true;
    settledMessage = message;
    if (!runId) {
      // The row does not exist yet; `work` finalizes it right after insertRun (see below).
      return;
    }
    void finishRun(options.tenant, runId, "failed", message, null).catch(() => undefined);
  };
  // Rearmed by every runtime event below, so it guards the first token and then the gaps
  // between them instead of capping the whole run.
  const stall = armRunStallGuard({
    model,
    locale,
    onStall: (message) => {
      if (queueClosed) {
        return;
      }
      send({ type: "run.failed", message });
      send({ type: "run.completed", runId: runId ?? "unknown" });
      closeQueue();
      settleRun(message);
    },
  });
  const onClientAbort = () => {
    if (queueClosed) {
      return;
    }
    const message = abortErrorMessage(options.abortSignal?.reason, locale);
    send({ type: "run.failed", message });
    send({ type: "run.completed", runId: runId ?? "unknown" });
    closeQueue();
    settleRun(message);
  };
  options.abortSignal?.addEventListener("abort", onClientAbort, { once: true });

  const work = (async () => {
    let assistantText = "";
    let thinkingText = "";
    let failedMessage = "";
    const mediaParts: ContentPart[] = [];
    const toolTrace: ToolCallPart[] = [];
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
      if (settled) {
        // Client went away (or the watchdog fired) while the user message was being stored.
        await finishRun(options.tenant, run.id, "failed", settledMessage || "client_disconnected", null);
        return;
      }
      const historyRows = await listMessages(options.tenant, thread.id);
      const inlineLocal = shouldInlineLocalMediaForProvider(
        resolveProviderKeys(settings).openaiBaseUrl || resolvedGatewayBaseUrl(),
      );
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

      await withRunContext({ threadId: thread.id, agentId: thread.agentId, locale }, async () => {
        await runtime.execute({
          tenant: options.tenant,
          runId: run.id,
          modality: options.modality,
          version,
          bindings: withPastSessionsBinding(published.bindings),
          history,
          thinking: thinkingEnabled,
          reasoningEffort,
          wire,
          locale,
          onEvent: async (event) => {
            stall.touch();
            if (isRunOutputEvent(event)) {
              stall.touchOutput();
            }
            if (event.type === "run.failed") {
              failedMessage = redactSecrets(event.message);
              send({ ...event, message: failedMessage });
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
              const last = [...toolTrace]
                .reverse()
                .find((item) => item.toolKey === event.toolKey && item.status === "started");
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
                // Every generated URL is mirrored into the local store first: the renderer
                // only loads host-served media, so a part we cannot mirror is dropped
                // rather than persisted as a remote URL that would never display.
                const mirrored = await mirrorToolMediaPart(options.tenant, part);
                if (mirrored) {
                  mediaParts.push(mirrored);
                }
              }
            }
          },
        });
      });
      if (settled) {
        return;
      }
      await persistAssistant();
      const finished = await finishRun(options.tenant, run.id, "completed", undefined, runUsage);
      // The Retrieved edge of the knowledge loop: one row per chunk this run was actually given.
      // Counted only for a completed run, and never allowed to fail one.
      if (recordsRetrievals(finished, "completed")) {
        recordRetrievals(options.tenant, {
          threadId: thread.id,
          runId: run.id,
          backend: knowledge.backend,
          chunks: knowledge.chunks,
        });
        // The Cited edge of the loop: what the reply itself pointed at with its `[n]` markers, as
        // opposed to what it was offered above. Same once-per-completed-turn discipline, and just
        // as unable to fail the run — an empty citation set writes nothing.
        recordCites(options.tenant, {
          threadId: thread.id,
          sourceIds: citedSources(assistantText, knowledge.chunks),
        });
      }
      if (finished && assistantText.trim()) {
        // Fire-and-forget: indexing must not delay stream end. One card per thread, latest exchange only.
        // Anything that goes wrong here is a knowledge concern, never a run failure.
        try {
          const fresh = await getThread(options.tenant, thread.id).catch(() => null);
          ingestWorkSource(
            options.tenant,
            chatWorkCard({
              threadId: thread.id,
              title: fresh?.title ?? "",
              userText,
              assistantText,
              model,
            }),
          );
        } catch (error) {
          console.warn(`knowledge-ingest: chat card skipped (${error instanceof Error ? error.message : "unknown"})`);
        }
      }
    } catch (error) {
      if (settled) {
        return;
      }
      const message = redactSecrets(error instanceof Error ? error.message : "run_failed");
      const saved = await persistAssistant();
      if (runId) {
        const status = saved ? "completed" : "failed";
        const finished = await finishRun(options.tenant, runId, status, saved ? undefined : message, runUsage);
        // A run that broke mid-stream but still saved partial text ends `completed`, and it was
        // given the same chunks the happy path was. Counting it there and not here would undercount
        // the Retrieved edge exactly when retrieval is most worth measuring.
        if (recordsRetrievals(finished, status)) {
          recordRetrievals(options.tenant, {
            threadId: thread.id,
            runId,
            backend: knowledge.backend,
            chunks: knowledge.chunks,
          });
          // A run that broke mid-stream but still saved partial text was given the same chunks and
          // may cite the same sources; its Cited edge is counted here or not at all.
          recordCites(options.tenant, {
            threadId: thread.id,
            sourceIds: citedSources(assistantText, knowledge.chunks),
          });
        }
      }
      if (!saved && !failedMessage) {
        send({ type: "run.failed", message });
      }
      send({ type: "run.completed", runId: runId ?? "unknown" });
    } finally {
      stall.close();
      options.abortSignal?.removeEventListener("abort", onClientAbort);
      closeQueue();
    }
  })();

  try {
    yield* queue;
  } finally {
    // Do not await `work` here. A wedged model call would block host:stream-end
    // and leave the packaged composer on Running forever.
    void work.catch(() => undefined);
  }
}

/**
 * Copy a tool's generated media into the local store and return the part pointing at it.
 * Returns null when the media cannot be mirrored (blocked host, over cap, bad response):
 * the turn keeps its text and drops the picture rather than carrying a remote URL.
 */
async function mirrorToolMediaPart(tenant: TenantContext, part: ContentPart): Promise<ContentPart | null> {
  try {
    if (part.type === "image_url") {
      const stored = await saveGeneratedImage(tenant, part.image_url.url);
      return { type: "image_url", image_url: { url: stored } };
    }
    if (part.type === "video_url") {
      const stored = await saveGeneratedVideo(tenant, part.video_url.url);
      return { type: "video_url", video_url: { url: stored } };
    }
    return part;
  } catch (error) {
    console.warn(`tool-media: generated media not mirrored (${error instanceof Error ? error.message : "unknown"})`);
    return null;
  }
}
