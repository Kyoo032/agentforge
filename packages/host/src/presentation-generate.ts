import {
  ApiError,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import {
  mergePresentationSlide,
  parsePresentationOutline,
  parsePresentationOutlineBody,
  parsePresentationSlide,
  type PresentationOutline,
} from "./presentation-outline";
import {
  appendRegenInstruction,
  collectJobAssistantText,
  readJobRegenAttachments,
  readOptionalInstruction,
} from "./job-regen";

const OUTLINE_SYSTEM = `You create presentation outlines a stranger can present from — not title-only skeletons.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": string,
  "slides": [
    { "heading": string, "bullets": string[], "notes": string }
  ]
}
Rules:
- Honor the user's requested slide count and arc. Default 7–9 slides (max 14).
- Heading is a claim, not a topic label.
- 3–5 bullets per slide. Each bullet is a complete thought (roughly 8–18 words), not a one-word stub.
- notes is required: what the speaker argues if the room pushes back. Not "keep it short."
- Use the sample story in the prompt. Tag invented figures [sample].
- No "team / traction / vision" filler. No "excited to share." No empty TBD slides.
- Do not invent revenue, logos, or uptime.
- No campus / student / course nouns unless the topic itself requires them.`;

function readPrompt(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError("invalid_request", "prompt is required", 400);
  }
  return prompt.trim();
}

function readOptionalModel(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

async function collectAssistantText(tenant: TenantContext, model: string, prompt: string): Promise<string> {
  return collectJobAssistantText({
    tenant,
    model,
    systemPrompt: OUTLINE_SYSTEM,
    runPrefix: "presentation",
    agentId: "presentation",
    versionId: "presentation-outline",
    prompt,
  });
}

function requireLivePresentationRuntime(): ReturnType<typeof loadSettings> {
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError(
      "runtime_stub",
      "Presentation generation needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
      503,
    );
  }
  return settings;
}

function resolvePresentationModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(
    readOptionalModel(body),
    settings.presentationGenModel || defaults.presentations,
    catalog,
  );
}

/** Generate a validated presentation outline via the same runtime path as chat. */
export async function generatePresentationOutline(
  tenant: TenantContext,
  body: unknown,
): Promise<PresentationOutline> {
  const prompt = readPrompt(body);
  const settings = requireLivePresentationRuntime();
  const model = resolvePresentationModel(body, settings);
  const raw = await collectAssistantText(tenant, model, prompt);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty presentation outline", 502);
  }
  return parsePresentationOutline(raw);
}

const SLIDE_SYSTEM = `You rewrite one slide of an Agentforge presentation.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{ "heading": string, "bullets": string[], "notes": string }
Rules:
- 2 to 5 concise bullets.
- notes is optional speaker notes (empty string if none).
- Stay on the same topic as the rest of the deck.
- No campus / student / course nouns unless the topic itself requires them.`;

function readSlideIndex(body: unknown, length: number): number {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const index = (body as { slideIndex?: unknown }).slideIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
    throw new ApiError("invalid_request", "slideIndex is out of range", 400);
  }
  return index;
}

export async function regeneratePresentationSlide(
  tenant: TenantContext,
  body: unknown,
): Promise<PresentationOutline> {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const outline = parsePresentationOutlineBody((body as { outline?: unknown }).outline);
  const index = readSlideIndex(body, outline.slides.length);
  const topic = typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const current = outline.slides[index];
  if (!current) {
    throw new ApiError("invalid_request", "slideIndex is out of range", 400);
  }
  const settings = requireLivePresentationRuntime();
  const model = resolvePresentationModel(body, settings);
  const attachments = readJobRegenAttachments(body);
  const others = outline.slides
    .map((slide, itemIndex) => (itemIndex === index ? null : `- ${slide.heading}`))
    .filter(Boolean)
    .join("\n");
  const prompt = appendRegenInstruction(
    [
      topic ? `Original topic: ${topic}` : null,
      `Deck title: ${outline.title}`,
      others ? `Other slides:\n${others}` : null,
      `Rewrite this slide only.\nHeading: ${current.heading}\nBullets:\n${current.bullets.map((item) => `- ${item}`).join("\n")}\nNotes: ${current.notes}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    readOptionalInstruction(body),
  );
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: SLIDE_SYSTEM,
    runPrefix: "presentation-slide",
    agentId: "presentation",
    versionId: "presentation-slide",
    prompt,
    attachments,
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty slide", 502);
  }
  return mergePresentationSlide(outline, index, parsePresentationSlide(raw));
}
