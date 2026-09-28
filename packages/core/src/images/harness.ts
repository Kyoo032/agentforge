import { mediaKind } from "../models/media-kind";

/**
 * Images harness for a person who brings no method.
 *
 * Write a brief, choose a frame, make one still, and try once more only when the
 * call never reached the gateway. Keeping the file stays in the host.
 */

export type ImageAspect = "square" | "landscape" | "portrait";

export type ImageSkillAttempt = {
  prompt: string;
  aspect: ImageAspect;
  model: string;
};

export class ImageModelRejectedError extends Error {
  constructor() {
    super("image_model_rejected");
    this.name = "ImageModelRejectedError";
  }
}

const PORTRAIT = /\b(poster|story|cover|portrait|vertical|sampul|potret|vertikal|9:16|9x16)\b/i;
const LANDSCAPE = /\b(banner|header|landscape|wide|cinematic|widescreen|horizontal|lanskap|sinematik|16:9|16x9)\b/i;

/** A connection that never reached the gateway. A timeout may already have billed. */
const RETRY_ONCE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|failed to fetch/i;
const NEVER_RETRY = /timed out|timeout|billed|gateway key|is not set|does not make images/i;

/** Their sentence is the subject. The scaffold is the method they did not bring. */
export function writeImageBrief(prompt: string): string {
  const subject = prompt.trim();
  return [
    "One still image.",
    `Subject: ${subject}`,
    "Single frame, not a collage and not a contact sheet.",
    "Do not add readable text, logos, or watermarks unless the subject asks for them.",
  ].join("\n");
}

/**
 * Use an explicit frame when they picked one.
 * Otherwise a poster is portrait, a banner is landscape, and a clash stays square.
 */
export function chooseImageFrame(prompt: string, aspect?: ImageAspect): ImageAspect {
  if (aspect) {
    return aspect;
  }
  const portrait = PORTRAIT.test(prompt);
  const landscape = LANDSCAPE.test(prompt);
  if (portrait && !landscape) {
    return "portrait";
  }
  if (landscape && !portrait) {
    return "landscape";
  }
  return "square";
}

/** An empty id is resolved by the caller. Anything else must be an image model. */
export function imageModelAccepted(model: string): boolean {
  const id = model.trim();
  if (!id) {
    return true;
  }
  return mediaKind(id) === "image";
}

export function imageMissMayRetry(message: string): boolean {
  const text = message.trim();
  if (!text || NEVER_RETRY.test(text)) {
    return false;
  }
  return RETRY_ONCE.test(text);
}

export type ImageSkillResult<T> = {
  url: string;
  aspect: ImageAspect;
  brief: string;
  attempts: number;
  extra?: T;
};

/**
 * Run the skills that happen before the file is kept.
 * The execute callback is one image call. A retry uses the same attempt.
 */
export async function runImageSkills<T>(input: {
  prompt: string;
  aspect?: ImageAspect;
  model: string;
  execute: (attempt: ImageSkillAttempt) => Promise<{ url: string | null; error?: string; extra?: T }>;
}): Promise<ImageSkillResult<T>> {
  const model = input.model.trim();
  if (!imageModelAccepted(model)) {
    throw new ImageModelRejectedError();
  }
  const aspect = chooseImageFrame(input.prompt, input.aspect);
  const brief = writeImageBrief(input.prompt);
  const attempt: ImageSkillAttempt = { prompt: brief, aspect, model };
  let result = await input.execute(attempt);
  let attempts = 1;
  if (!result.url && imageMissMayRetry(result.error ?? "")) {
    result = await input.execute(attempt);
    attempts = 2;
  }
  if (!result.url) {
    throw new Error(result.error?.trim() || "image_generate_failed");
  }
  return {
    url: result.url,
    aspect,
    brief,
    attempts,
    ...(result.extra !== undefined ? { extra: result.extra } : {}),
  };
}
