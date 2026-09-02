import {
  ApiError,
  assertModelSupportsModality,
  createRuntime,
  type AgentVersionRecord,
  type ContentPart,
  type ImageUrlPart,
  type TenantContext,
} from "@agentforge/core";
import { isRenderableImageUrl } from "./composer-attach";
import { inlineLocalMediaParts } from "./inline-local-media";
import { rememberJobUsage } from "./job-usage";
import { loadSettings } from "./settings-store";

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

export async function collectJobAssistantText(options: {
  tenant: TenantContext;
  model: string;
  systemPrompt: string;
  runPrefix: string;
  agentId: string;
  versionId: string;
  prompt: string;
  attachments?: ImageUrlPart[];
}): Promise<string> {
  const settings = loadSettings();
  const runtime = createRuntime(settings);
  const attachments = options.attachments ?? [];
  if (attachments.length > 0) {
    assertModelSupportsModality(options.model, "image");
  }
  const imageParts =
    attachments.length > 0 ? await inlineLocalMediaParts(options.tenant, attachments) : [];
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

  let assistantText = "";
  let failedMessage = "";
  const parts: ContentPart[] = [{ type: "text", text: options.prompt }, ...imageParts];

  await runtime.execute({
    tenant: options.tenant,
    runId: `${options.runPrefix}-${Date.now()}`,
    modality: "text",
    version,
    bindings: [],
    history: [{ role: "user", parts }],
    onEvent: (event) => {
      if (event.type === "assistant.delta") {
        assistantText += event.text;
      }
      if (event.type === "run.failed") {
        failedMessage = event.message;
      }
      rememberJobUsage(event);
    },
  });

  if (failedMessage) {
    throw new ApiError("generation_failed", failedMessage, 502);
  }
  return assistantText;
}
