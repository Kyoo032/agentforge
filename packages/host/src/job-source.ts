import { ApiError, scanInjection } from "@agentforge/core";

/** Cap on pasted / handed-off source material in one job request (chars). */
export const SOURCE_TEXT_MAX_CHARS = 120_000;
export const SOURCE_TRUNCATED_MARKER = "[source material truncated at cap]";

export const SOURCE_MATERIAL_RULE =
  "When source material is supplied, use only that material for facts, figures, names, and quotes. Do not add facts from memory. If the material does not cover something the user asked for, say so in the text instead of inventing it.";

export type SourceTextOptions = {
  /** Mirrors the chat attachment guard: owner may switch it off in Settings. */
  injectionGuardBypass?: boolean;
};

function capSourceText(text: string): string {
  if (text.length <= SOURCE_TEXT_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, SOURCE_TEXT_MAX_CHARS)}\n${SOURCE_TRUNCATED_MARKER}`;
}

/** Same guard chat applies to attachments; source material goes straight into the prompt so it must pass too. */
export function assertSafeSourceText(text: string, options: SourceTextOptions = {}): void {
  if (options.injectionGuardBypass || !text) {
    return;
  }
  const hit = scanInjection(text);
  if (hit) {
    throw new ApiError(
      "injection_blocked",
      `Source material was blocked by the injection guard (rule: ${hit.rule}). Remove the flagged instructions, or turn the guard off in Settings.`,
      400,
    );
  }
}

/** Optional `sourceText` body field. Empty string when absent. */
export function readSourceText(body: unknown, options: SourceTextOptions = {}): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const raw = (body as { sourceText?: unknown }).sourceText;
  if (raw === undefined || raw === null) {
    return "";
  }
  if (typeof raw !== "string") {
    throw new ApiError("invalid_request", "sourceText must be a string", 400);
  }
  const text = capSourceText(raw.trim());
  assertSafeSourceText(text, options);
  return text;
}

export function withSourceMaterial(prompt: string, sourceText: string): string {
  if (!sourceText) {
    return prompt;
  }
  return `${prompt}\n\nSource material (use only this for facts):\n<<<\n${sourceText}\n>>>`;
}

export function withSourceRule(systemPrompt: string, sourceText: string): string {
  return sourceText ? `${systemPrompt}\n- ${SOURCE_MATERIAL_RULE}` : systemPrompt;
}
