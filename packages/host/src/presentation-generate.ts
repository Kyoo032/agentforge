import {
  ApiError,
  hasLiveProvider,
  modeMessage,
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
  collectJobAssistantRun,
  collectJobAssistantText,
  readJobRegenAttachments,
  readModelPinned,
  readOptionalInstruction,
  type JobAssistantRun,
} from "./job-regen";
import { readSourceText, withSourceMaterial, withSourceRule } from "./job-source";
import { artifactStore } from "./artifacts";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard, presentationOutlineMarkdown } from "./work-cards";
import {
  presentationGatewayMessage,
  presentationLanguageRule,
  presentationLocale,
  type PresentationLocale,
} from "./presentation-locale";
import { log } from "./log";

const OUTLINE_SYSTEM = `You write finished presentation outlines a stranger can present from. Return ONLY JSON (no markdown fences).
Shape:
{"title":string,"slides":[{"kind":"section"|"bullets"|"split"|"close","heading":string,"subhead":string,"bullets":string[],"aside":string,"notes":string}]}
Rules:
- Honor the requested slide count. Default 8–12 (max 14). title is the title slide — do not add a Title content slide.
- Mix kinds: one section opener, mostly bullets, at least one split, last slide close.
- heading: a spoken claim, 6–14 words. Never Overview, Agenda, Introduction, Team, Traction, Thank you, Q&A, or Next steps.
- subhead: one tightening line.
- bullets: 3–5 complete thoughts, 10–22 words, with names, dates, owners, or decisions. section may have 0–2. No one-word stubs.
- aside: required on split (1–2 sentences to point at). Empty on other kinds.
- notes: required, 40–90 words, what to say if they push back. Not "keep it short."
- Use the sample story. Tag invented figures [sample]. No "excited to share." No TBD. Do not invent revenue, logos, or uptime.
- No campus / student / course nouns unless the topic itself requires them.
- {languageRule}
Example (copy the shape, not the facts):
{"title":"Saturday pickup week of 6 Sep","slides":[{"kind":"section","heading":"The door menu is the only sentence that matters","subhead":"The whiteboard is current; anyone reading the door is a month behind.","bullets":[],"aside":"","notes":"If they say the reprint can wait, remind them anyone who only reads the door will not see the new Saturday hours. Offer a yes or no this Thursday, not a backlog item. Do not bury the gap under process slides."},{"kind":"bullets","heading":"What we can show at the counter today","subhead":"Open the till log if they want evidence.","bullets":["Named bags are ready for the first twenty pre-orders.","The spare card reader sits on the counter, not in the back room.","A second shop can wait; we did not open one here."],"aside":"","notes":"Walk them to the counter if they want proof. Do not send them to a binder they have not opened. The proof is a named bag on this counter, not a plan on paper."},{"kind":"split","heading":"I will not paper over a thin Saturday","subhead":"Old handover cards were one sentence.","bullets":["The counter then ran from guesswork and mixed up two orders.","The checklist now names who collects, what done looks like, and a sample Saturday.","The remaining risk is a Saturday run from a blank card."],"aside":"This is a print miss, not a counter miss.","notes":"If they ask for a prettier menu instead of a better checklist, say the menu only helps when the bags have names and the reader works. Show the checklist if they want proof."},{"kind":"close","heading":"Thursday is a yes or no on the reprint","subhead":"Owner of the call: you.","bullets":["Reprint the door menu this week, or keep the whiteboard.","I will not call the August sheet the current hours.","Friday: a six-line recap whether or not we reprinted."],"aside":"","notes":"If they defer, write deferred on the recap. Do not leave the decision implied. Three outcomes this week; a fourth waits."}]}`;

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

function outlineSystem(locale: PresentationLocale): string {
  return OUTLINE_SYSTEM.replace("{languageRule}", presentationLanguageRule(locale));
}

function slideSystem(locale: PresentationLocale): string {
  return `${SLIDE_SYSTEM}\n- ${presentationLanguageRule(locale)}`;
}

/** One outline call. The run says which model answered, which is the one the artifact records. */
function collectAssistantRun(
  tenant: TenantContext,
  model: string,
  prompt: string,
  sourceText: string,
  locale: PresentationLocale,
  modelExplicit: boolean,
): Promise<JobAssistantRun> {
  return collectJobAssistantRun({
    tenant,
    model,
    // A model the person picked is never swapped by the fallback; a seeded default can be.
    modelExplicit,
    systemPrompt: withSourceRule(outlineSystem(locale), sourceText),
    runPrefix: "presentation",
    agentId: "presentation",
    jobMode: "presentations",
    versionId: "presentation-outline",
    prompt: withSourceMaterial(prompt, sourceText),
  });
}

function requireLivePresentationRuntime(tenant: TenantContext): ReturnType<typeof loadSettings> {
  const settings = loadSettings(tenant);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", presentationGatewayMessage(presentationLocale()), 503);
  }
  return settings;
}

function resolvePresentationModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(readOptionalModel(body), settings.presentationGenModel || defaults.presentations, catalog);
}

/** Save the outline as a `presentations / draft` artifact. Never fails the job. */
function persistOutline(
  tenant: TenantContext,
  outline: PresentationOutline,
  markdown: string,
  meta: Record<string, unknown>,
): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "presentations",
      kind: "draft",
      title: outline.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("presentation_outline_not_saved", { code });
    return null;
  }
}

/** Generate a validated presentation outline via the same runtime path as chat. */
export async function generatePresentationOutline(tenant: TenantContext, body: unknown): Promise<PresentationOutline> {
  const prompt = readPrompt(body);
  const settings = requireLivePresentationRuntime(tenant);
  const locale = presentationLocale();
  const sourceText = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const model = resolvePresentationModel(body, settings);
  const run = await collectAssistantRun(tenant, model, prompt, sourceText, locale, readModelPinned(body));
  if (!run.text.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyPresentationOutline", locale), 502);
  }
  const outline = parsePresentationOutline(run.text);
  const markdown = presentationOutlineMarkdown(outline);
  // Record the model that wrote the outline. After a fallback the requested id is the one model that did not.
  const answeredBy = run.model;
  const artifactId = persistOutline(tenant, outline, markdown, {
    question: prompt,
    model: answeredBy,
    slides: outline.slides.length,
  });
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({ type: "Presentation", artifactId, title: outline.title, prompt, markdown, model: answeredBy }),
    );
  }
  return outline;
}

const SLIDE_SYSTEM = `You rewrite one slide of a DPSBuddy presentation.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{ "kind": "section" | "bullets" | "split" | "close", "heading": string, "subhead": string, "bullets": string[], "aside": string, "notes": string }
Rules:
- Keep the same kind unless the instruction names a different layout.
- heading is a spoken claim, not a topic label.
- bullets: 3–5 complete thoughts (10–22 words). section may have 0–2. split needs 3–4 plus aside.
- notes: 40–90 words, what to say if they push back.
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

export async function regeneratePresentationSlide(tenant: TenantContext, body: unknown): Promise<PresentationOutline> {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const outline = parsePresentationOutlineBody((body as { outline?: unknown }).outline);
  const index = readSlideIndex(body, outline.slides.length);
  const topic =
    typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const current = outline.slides[index];
  if (!current) {
    throw new ApiError("invalid_request", "slideIndex is out of range", 400);
  }
  const settings = requireLivePresentationRuntime(tenant);
  const locale = presentationLocale();
  const model = resolvePresentationModel(body, settings);
  const attachments = readJobRegenAttachments(body);
  const sourceText = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const others = outline.slides
    .map((slide, itemIndex) => (itemIndex === index ? null : `- ${slide.heading}`))
    .filter(Boolean)
    .join("\n");
  const prompt = appendRegenInstruction(
    [
      topic ? `Original topic: ${topic}` : null,
      `Deck title: ${outline.title}`,
      others ? `Other slides:\n${others}` : null,
      `Rewrite this slide only.\nKind: ${current.kind}\nHeading: ${current.heading}\nSubhead: ${current.subhead}\nBullets:\n${current.bullets.map((item) => `- ${item}`).join("\n")}\nAside: ${current.aside}\nNotes: ${current.notes}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    readOptionalInstruction(body),
  );
  const raw = await collectJobAssistantText({
    tenant,
    model,
    modelExplicit: readModelPinned(body),
    systemPrompt: withSourceRule(slideSystem(locale), sourceText),
    runPrefix: "presentation-slide",
    agentId: "presentation",
    jobMode: "presentations",
    versionId: "presentation-slide",
    prompt: withSourceMaterial(prompt, sourceText),
    attachments,
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptySlide", locale), 502);
  }
  return mergePresentationSlide(outline, index, parsePresentationSlide(raw));
}
