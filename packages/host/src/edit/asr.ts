import { mediaKind, resolvedGatewayBaseUrl } from "@agentforge/core";
import { loadModelCache } from "../model-cache";
import { loadSettings, type SettingsScope } from "../settings-store";

const ASR_ID = /whisper|transcribe/i;

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
  /** Tenant and desk whose gateway key pays for the transcription. */
  scope?: SettingsScope,
): Promise<{ text: string }> {
  const cap = resolveAsrCapability();
  if (!cap.available || !cap.model) {
    return { text: "" };
  }
  const settings = loadSettings(scope);
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
    const response = await fetchImpl(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) {
      if (response.status >= 500) {
        const retry = await fetchImpl(`${base}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });
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
