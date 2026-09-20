import { mediaKind, resolvedGatewayBaseUrl } from "@agentforge/core";
import { loadModelCache } from "../model-cache";
import { loadSettings } from "../settings-store";

const ASR_ID = /whisper|transcribe/i;

/**
 * How long one chunk of audio may take before the request is given up on.
 *
 * There was no timeout at all: a gateway that accepted the connection and then went quiet held the
 * Edit job open forever, and the 5xx retry below re-uploaded the whole chunk on top of it
 * (docs/internal/security-owasp-2026-09.md, A10-4). Generous, because this is a model call over an
 * upload, not an API ping.
 */
const ASR_TIMEOUT_MS = 120_000;

/**
 * The options every transcription request shares.
 *
 * `redirect: "manual"` is the security half: this request carries the gateway key as a bearer
 * token, and the default "follow" would replay that key to whatever host a 3xx names. The gateway
 * base URL is pinned (`resolvedGatewayBaseUrl`), so a redirect is not something the app asks for;
 * with this set, one arrives as a non-ok response and the chunk is simply skipped.
 */
function asrRequestInit(key: string, form: FormData): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
  };
}

export type AsrCapability = {
  available: boolean;
  backend: string | null;
  model: string | null;
};

export function resolveAsrCapability(): AsrCapability {
  const envModel = process.env.AGENTFORGE_EDIT_ASR_MODEL?.trim();
  if (envModel) {
    return { available: true, backend: "gateway", model: envModel };
  }
  const cache = loadModelCache();
  const ids = [
    ...(cache.openai ?? []),
    ...(cache.anthropic ?? []),
    ...(cache.google ?? []),
    ...(cache.volcengine ?? []),
  ].map((model) => model.id);
  const audio = ids.filter((id) => mediaKind(id) === "audio" && ASR_ID.test(id));
  const model = audio[0] ?? null;
  return {
    available: Boolean(model),
    backend: model ? "gateway" : null,
    model,
  };
}

export async function transcribeAudioChunks(
  files: string[],
  language?: string,
  fetchImpl: typeof fetch = fetch,
  /** Desk whose gateway key pays for the transcription. */
  deskId?: string,
): Promise<{ text: string }> {
  const cap = resolveAsrCapability();
  if (!cap.available || !cap.model) {
    return { text: "" };
  }
  const settings = loadSettings(deskId);
  const key = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    return { text: "" };
  }
  const base = resolvedGatewayBaseUrl();
  const parts: string[] = [];
  for (const file of files) {
    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(file));
    const form = new FormData();
    form.set("model", cap.model);
    form.set("file", new Blob([bytes], { type: "audio/mpeg" }), "chunk.mp3");
    if (language) {
      form.set("language", language);
    }
    const response = await fetchImpl(`${base}/audio/transcriptions`, asrRequestInit(key, form));
    if (!response.ok) {
      if (response.status >= 500) {
        const retry = await fetchImpl(`${base}/audio/transcriptions`, asrRequestInit(key, form));
        if (!retry.ok) {
          continue;
        }
        const json = (await retry.json()) as { text?: string };
        if (json.text) {
          parts.push(json.text);
        }
        continue;
      }
      continue;
    }
    const json = (await response.json()) as { text?: string };
    if (json.text) {
      parts.push(json.text);
    }
  }
  return { text: parts.join(" ").trim() };
}
