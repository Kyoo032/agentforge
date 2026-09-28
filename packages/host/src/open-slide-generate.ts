import {
  ApiError,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
  withOutputLanguage,
  type TenantContext,
} from "@agentforge/core";
import {
  applyOpenSlideSkills,
  draftOpenSlideDeck,
  OPEN_SLIDE_SYSTEM,
  openSlidePageBracket,
  parseOpenSlideModelText,
  readOpenSlideChoices,
  type OpenSlideDeck,
} from "@agentforge/core/open-slide";
import { artifactStore } from "./artifacts";
import { collectJobAssistantRun, readModelPinned, type JobAssistantRun } from "./job-regen";
import { readSourceText, withSourceMaterial, withSourceRule } from "./job-source";
import { upsertWorkSource } from "./knowledge-ingest";
import { log } from "./log";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { presentationLocale, presentationSkillCopy } from "./presentation-locale";
import { artifactWorkCard } from "./work-cards";

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

function userPrompt(
  prompt: string,
  choices: ReturnType<typeof readOpenSlideChoices>,
  retry?: { pages: number },
): string {
  const bracket = openSlidePageBracket(choices.pageCount);
  const lines = [
    `Topic: ${prompt}`,
    `Page count bracket: ${choices.pageCount}.`,
    `Text density: ${choices.density}.`,
    `Motion: ${choices.motion}. Record it on brief.motion. Pages stay static boxes.`,
    "Pick one aesthetic that fits the topic and write it on brief.aesthetic.",
  ];
  if (retry) {
    lines.push(
      `The deck has ${retry.pages} pages. This bracket needs at least ${bracket.min} and at most ${bracket.max}. Return the full JSON deck with enough pages. Do not invent a figure.`,
    );
  }
  return lines.join("\n");
}

function emptyDeckMessage(locale: ReturnType<typeof presentationLocale>): string {
  return locale === "id" ? "Open Slide tidak mengembalikan dek." : "Open Slide returned an empty deck.";
}

function invalidDeckMessage(locale: ReturnType<typeof presentationLocale>): string {
  return locale === "id"
    ? "Open Slide mengembalikan dek yang tidak dapat dibaca."
    : "Open Slide returned a deck that could not be read.";
}

function openSlideMarkdown(deck: OpenSlideDeck): string {
  const lines = [`# ${deck.meta.title}`, ""];
  for (const [index, page] of deck.pages.entries()) {
    lines.push(`## ${index + 1}. ${page.role}`);
    for (const block of page.blocks) {
      if (block.text.trim()) {
        lines.push(block.text.trim());
      }
    }
    if (page.notes.trim()) {
      lines.push("", page.notes.trim());
    }
    lines.push("");
  }
  return lines.join("\n");
}

function resolveModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(readOptionalModel(body), settings.presentationGenModel || defaults.presentations, catalog);
}

async function collectDeck(
  tenant: TenantContext,
  model: string,
  prompt: string,
  sourceText: string,
  choices: ReturnType<typeof readOpenSlideChoices>,
  modelExplicit: boolean,
  retry?: { pages: number },
): Promise<JobAssistantRun> {
  const locale = presentationLocale();
  const system = withOutputLanguage(OPEN_SLIDE_SYSTEM, "presentations", locale);
  return collectJobAssistantRun({
    tenant,
    model,
    modelExplicit,
    systemPrompt: withSourceRule(system, sourceText),
    runPrefix: "presentation",
    agentId: "presentation",
    jobMode: "presentations",
    versionId: "open-slide-deck",
    prompt: withSourceMaterial(userPrompt(prompt, choices, retry), sourceText),
  });
}

function finishDeck(deck: OpenSlideDeck, prompt: string, sourceText: string) {
  return applyOpenSlideSkills(deck, {
    prompt,
    sourceText,
    copy: presentationSkillCopy(presentationLocale()),
  });
}

async function persistDeck(
  tenant: TenantContext,
  deck: OpenSlideDeck,
  markdown: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const artifactId = artifactStore().create(tenant, {
      mode: "presentations",
      kind: "draft",
      title: deck.meta.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Presentation",
        artifactId,
        title: deck.meta.title,
        prompt: deck.brief.topic,
        markdown,
        model: typeof meta.model === "string" ? meta.model : undefined,
      }),
    );
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("open_slide_deck_not_saved", { code });
  }
}

/**
 * Stub runtime drafts on this machine. A live runtime asks the gateway with the
 * Open Slide harness. Neither path calls an Open Slide host.
 */
export async function generateOpenSlideDeck(tenant: TenantContext, body: unknown): Promise<OpenSlideDeck> {
  const prompt = readPrompt(body);
  const choices = readOpenSlideChoices(body);
  const settings = loadSettings(tenant);
  const sourceText = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const locale = presentationLocale();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    return finishDeck(draftOpenSlideDeck({ prompt, ...choices, locale }), prompt, sourceText).deck;
  }
  const model = resolveModel(body, settings);
  const pinned = readModelPinned(body);
  const run = await collectDeck(tenant, model, prompt, sourceText, choices, pinned);
  if (!run.text.trim()) {
    throw new ApiError("generation_failed", emptyDeckMessage(locale), 502);
  }
  let deck: OpenSlideDeck;
  try {
    deck = parseOpenSlideModelText(run.text);
  } catch {
    throw new ApiError("invalid_outline", invalidDeckMessage(locale), 502);
  }
  let finished = finishDeck(deck, prompt, sourceText);
  if (finished.report.length === "short") {
    try {
      const retry = await collectDeck(tenant, model, prompt, sourceText, choices, pinned, {
        pages: finished.deck.pages.length,
      });
      if (retry.text.trim()) {
        finished = finishDeck(parseOpenSlideModelText(retry.text), prompt, sourceText);
      }
    } catch {
      // One retry. A short deck is still returned.
    }
  }
  deck = finished.deck;
  const markdown = openSlideMarkdown(deck);
  await persistDeck(tenant, deck, markdown, {
    question: prompt,
    model: run.model,
    pages: deck.pages.length,
    engine: "open-slide",
  });
  return deck;
}
