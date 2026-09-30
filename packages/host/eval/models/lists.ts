import {
  CHAT_DEFAULT_PREFERENCES,
  EVERYDAY_MODEL_IDS,
  JOB_FALLBACK_TAIL,
  JOB_MODE_PREFERENCES,
  MEDIA_MODEL_PREFERENCES,
} from "@agentforge/core";

/**
 * A ranked list the product picks or falls back by. `chat` lists name chat models and are matched
 * against the chat catalogue, as the product matches them; `media` lists name image, video, audio and
 * embedding models and are matched against everything the gateway lists.
 */
export type PreferenceList = { name: string; kind: "chat" | "media"; ids: readonly string[] };

/** Every list the product ranks or falls back by, read from the product's own constants, never copied. */
export function preferenceLists(): PreferenceList[] {
  return [
    { name: "CHAT_DEFAULT_PREFERENCES", kind: "chat", ids: CHAT_DEFAULT_PREFERENCES },
    { name: "EVERYDAY_MODEL_IDS", kind: "chat", ids: [...EVERYDAY_MODEL_IDS] },
    ...Object.entries(JOB_MODE_PREFERENCES).map(
      ([mode, ids]): PreferenceList => ({ name: `JOB_MODE_PREFERENCES.${mode}`, kind: "chat", ids }),
    ),
    { name: "JOB_FALLBACK_TAIL", kind: "chat", ids: JOB_FALLBACK_TAIL },
    ...Object.entries(MEDIA_MODEL_PREFERENCES).map(
      ([kind, ids]): PreferenceList => ({ name: `MEDIA.${kind}`, kind: "media", ids }),
    ),
  ];
}
