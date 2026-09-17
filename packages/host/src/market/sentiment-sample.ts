/**
 * The cleaning every retail-sentiment sample goes through before it can reach
 * a prompt. The shape itself is core's (`sentimentSampleSchema`), so what the
 * cache holds is exactly what the packet carries.
 *
 * Retail chatter is the least trustworthy text this host ingests: it is
 * anonymous, unmoderated, and an obvious place to plant an instruction. So a
 * sample is HTML-stripped and normalised (`sanitizeExternalText`), dropped
 * outright when it reads like an instruction — rather than kept and flagged, as
 * a wire-service headline is — PII-masked, and cut to
 * `SENTIMENT_SAMPLE_CHARS_MAX`. A post body is only ever kept as a title; no
 * links, no authors, no user handles.
 */
import { maskPii } from "@agentforge/core";
import {
  SENTIMENT_SAMPLE_CHARS_MAX,
  sentimentSampleSchema,
  type SentimentSample,
  type SentimentSampleSource,
} from "@agentforge/core/market";
import { sanitizeExternalText } from "./sanitize";

export { SENTIMENT_SAMPLE_CHARS_MAX, sentimentSampleSchema };
export type { SentimentSample, SentimentSampleSource };

const ELLIPSIS = "…";

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
}

function isoOrUndefined(at: string | null | undefined): string | undefined {
  if (!at) {
    return undefined;
  }
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * One cleaned sample, or null when the text was empty or instruction-like.
 * Pure: returns a new object and never mutates its input.
 */
export function sentimentSample(
  source: SentimentSampleSource,
  raw: string,
  at?: string | null,
): SentimentSample | null {
  const clean = sanitizeExternalText(raw ?? "");
  if (!clean.text || clean.injectionSuspect) {
    return null;
  }
  const title = truncate(maskPii(clean.text), SENTIMENT_SAMPLE_CHARS_MAX).trim();
  if (!title) {
    return null;
  }
  const when = isoOrUndefined(at);
  return sentimentSampleSchema.parse({ source, title, ...(when ? { at: when } : {}) });
}
