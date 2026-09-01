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
  resolveChatModel,
  type ContentPart,
  type InputModality,
  type TenantContext,
  type ToolBindingRecord,
} from "@agentforge/core";
import { ApiError } from "@agentforge/core";
import { agentService } from "./tenant";
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

function hasVisibleText(parts: ContentPart[]): boolean {
  return parts.some((part) => part.type === "text" && part.text.trim().length > 0);
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

export async function startModalityRun(options: {
  tenant: TenantContext;
  threadId: string;
  modality: InputModality;
  body: unknown;
}): Promise<Response> {
  ensureToolsRegistered();
  const parsed = parsers[options.modality](options.body as { content?: unknown; stream?: unknown });
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
  const version = {
    ...published.version,
    model,
    systemPrompt: published.version.systemPrompt + pastHint,
  };
  assertAgentSupportsModality(published.version.inputModalities, options.modality);
  assertModelSupportsModality(version.model, options.modality);

  const encoder = new TextEncoder();
  let assistantText = "";
  let thinkingText = "";
  let failedMessage = "";
  const mediaParts: ContentPart[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Parameters<typeof encodeSse>[0]) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };
      controller.enqueue(encoder.encode(": connected\n\n"));
      let runId: string | null = null;
      let persisted = false;
      let runUsage: Record<string, unknown> | null = null;
      const persistAssistant = async () => {
        const reply = assistantText.trim() || thinkingText.trim();
        const assistantParts: ContentPart[] = [];
        if (reply) {
          assistantParts.push({ type: "text", text: reply });
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
        await insertMessage(options.tenant, thread.id, "user", parsed.parts);
        await setThreadTitleFromParts(options.tenant, thread.id, parsed.parts);
        const run = await insertRun(options.tenant, thread.id, published.version.id, options.modality);
        runId = run.id;
        const historyRows = await listMessages(options.tenant, thread.id);
        const settings = loadSettings();
        const inlineLocal = shouldInlineLocalMediaForProvider(settings.openaiBaseUrl);
        const history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }> = [];
        for (const row of historyRows) {
          if (row.role !== "user" && row.role !== "assistant") {
            continue;
          }
          const parts = row.content as ContentPart[];
          if (row.role === "assistant" && !hasVisibleText(parts)) {
            continue;
          }
          history.push({
            role: row.role as "user" | "assistant",
            parts:
              row.role === "user" && inlineLocal
                ? await inlineLocalMediaParts(options.tenant, parts)
                : parts,
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
                await insertToolInvocation(options.tenant, run.id, event.toolKey, event.input, null, "started");
              }
              if (event.type === "tool.completed") {
                await insertToolInvocation(options.tenant, run.id, event.toolKey, null, event.output, "completed");
                for (const part of collectToolMediaParts(event.output)) {
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
        const saved = mediaParts.length > 0 ? await persistAssistant() : false;
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
