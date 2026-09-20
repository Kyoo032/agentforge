import {
  ApiError,
  assertModelSupportsModality,
  createRuntime,
  type AgentVersionRecord,
  type AppLocale,
  type ContentPart,
  type ImageUrlPart,
  type JobMode,
  type JobModelFallbackNotice,
  type RuntimeEvent,
  type StreamWatchdogLimits,
  type TenantContext,
  type ToolBindingRecord,
  usageModeFromRunPrefix,
} from "@agentforge/core";
import { isRenderableImageUrl } from "./composer-attach";
import { inlineLocalMediaParts } from "./inline-local-media";
import { rememberJobUsage } from "./job-usage";
import { runWithJobModelFallback, type JobModelOutcome } from "./job-model-fallback";
import { loadSettings } from "./settings-store";
import { localeForRun } from "./run-context";

export function readOptionalInstruction(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const instruction = (body as { instruction?: unknown }).instruction;
  return typeof instruction === "string" ? instruction.trim() : "";
}

export function appendRegenInstruction(prompt: string, instruction: string): string {
  return instruction ? `${prompt}\n\nUser instruction:\n${instruction}` : prompt;
}

export function readJobRegenAttachments(body: unknown): ImageUrlPart[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const raw = (body as { attachments?: unknown }).attachments;
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ApiError("invalid_request", "attachments must be an array", 400);
  }
  const parts: ImageUrlPart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new ApiError("invalid_request", "Each attachment must be an image_url part", 400);
    }
    const record = item as { type?: unknown; image_url?: { url?: unknown; detail?: unknown } };
    const url = record.image_url && typeof record.image_url.url === "string" ? record.image_url.url.trim() : "";
    if (record.type !== "image_url" || !url || !isRenderableImageUrl(url)) {
      throw new ApiError("invalid_request", "Each attachment must be an image_url part", 400);
    }
    const detail = record.image_url?.detail;
    parts.push({
      type: "image_url",
      image_url: {
        url,
        detail: detail === "low" || detail === "high" || detail === "auto" ? detail : "high",
      },
    });
  }
  return parts;
}

async function runJobAssistantOnce(options: {
  tenant: TenantContext;
  model: string;
  systemPrompt: string;
  runPrefix: string;
  agentId: string;
  versionId: string;
  prompt: string;
  attachments?: ImageUrlPart[];
  /** Tool keys the model may call (registered tools only). Empty by default. */
  toolKeys?: string[];
  /** Observe runtime events (tool calls, deltas) while the job runs. */
  onEvent?: (event: RuntimeEvent) => void;
  /** Raise the stream watchdog above the model defaults for this run (never lowers them). */
  streamWatchdog?: Partial<StreamWatchdogLimits>;
  /** The studio this run belongs to. Sends the thinking-off knob on always-thinking models. */
  jobMode?: JobMode;
  /** App locale for runtime copy (timeouts, contact errors). Defaults to the run context. */
  locale?: AppLocale;
}): Promise<string> {
  const settings = loadSettings(options.tenant);
  const runtime = createRuntime(settings);
  const attachments = options.attachments ?? [];
  if (attachments.length > 0) {
    assertModelSupportsModality(options.model, "image");
  }
  const imageParts = attachments.length > 0 ? await inlineLocalMediaParts(options.tenant, attachments) : [];
  const version: AgentVersionRecord = {
    id: options.versionId,
    agentId: options.agentId,
    organizationId: options.tenant.organizationId,
    version: 1,
    systemPrompt: options.systemPrompt,
    model: options.model,
    inputModalities: attachments.length > 0 ? ["text", "image"] : ["text"],
    config: {},
    createdAt: new Date(),
  };

  // Every job run is metered against its tenant, under the mode its `runPrefix` names. Derived
  // rather than passed: the twenty job call sites already carry a prefix, and five of them have no
  // `JobMode` to give. See `usageModeFromRunPrefix` in @agentforge/core.
  const usageMode = usageModeFromRunPrefix(options.jobMode ?? options.runPrefix);
  const runId = `${options.runPrefix}-${Date.now()}`;

  let assistantText = "";
  let failedMessage = "";
  const parts: ContentPart[] = [{ type: "text", text: options.prompt }, ...imageParts];
  const bindings: ToolBindingRecord[] = (options.toolKeys ?? []).map((toolKey) => ({
    id: `${options.versionId}-${toolKey}`,
    agentVersionId: options.versionId,
    organizationId: options.tenant.organizationId,
    toolKey,
    config: {},
    enabled: true,
  }));

  await runtime.execute({
    tenant: options.tenant,
    runId,
    modality: "text",
    version,
    bindings,
    history: [{ role: "user", parts }],
    // Without this every job-side timeout and contact error is English on an Indonesian desk.
    locale: options.locale ?? localeForRun(),
    ...(options.streamWatchdog ? { streamWatchdog: options.streamWatchdog } : {}),
    ...(options.jobMode ? { jobMode: options.jobMode } : {}),
    onEvent: (event) => {
      if (event.type === "assistant.delta") {
        assistantText += event.text;
      }
      if (event.type === "run.failed") {
        failedMessage = event.message;
      }
      options.onEvent?.(event);
      rememberJobUsage(event, { tenant: options.tenant, mode: usageMode, runId });
    },
  });

  if (failedMessage) {
    throw new ApiError("generation_failed", failedMessage, 502);
  }
  return assistantText;
}

/** What a job run actually used: the text, the model that produced it, and any fallback notice. */
export type JobAssistantRun = {
  text: string;
  /** The model that answered — the stand-in when the requested one could not be reached. */
  model: string;
  /** Set only when a stand-in answered. `code` is `model_fallback`; the desk writes the sentence. */
  notice?: JobModelFallbackNotice;
};

export type JobAssistantOptions = Parameters<typeof runJobAssistantOnce>[0] & {
  /** The person picked this model in the UI for this request: return the error, never swap it. */
  modelExplicit?: boolean;
  /** Chat ids this workspace lists. Defaults to the live selectable catalog. */
  availableModelIds?: string[];
};

/**
 * One job call, with one retry on another model when the gateway could not be reached at all — so
 * a desk whose mode default is down still gets its brief instead of a 500. Callers that want to
 * show which model answered use this; the rest keep `collectJobAssistantText` and are rescued
 * without changing.
 */
export async function collectJobAssistantRun(options: JobAssistantOptions): Promise<JobAssistantRun> {
  const run = await runWithJobModelFallback(options, async (model): Promise<JobModelOutcome<string>> => {
    let streamed = false;
    try {
      const text = await runJobAssistantOnce({
        ...options,
        model,
        onEvent: (event) => {
          if (event.type === "assistant.delta" && event.text.length > 0) {
            streamed = true;
          }
          options.onEvent?.(event);
        },
      });
      return { ok: true, value: text };
    } catch (error) {
      return { ok: false, error, streamed };
    }
  });
  return { text: run.value, model: run.model, ...(run.notice ? { notice: run.notice } : {}) };
}

export async function collectJobAssistantText(options: JobAssistantOptions): Promise<string> {
  return (await collectJobAssistantRun(options)).text;
}
