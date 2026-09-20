import { z } from "zod";
import { resolvedGatewayBaseUrl } from "../../gateway";
import {
  MUSIC_LYRICS_MAX,
  MUSIC_PROMPT_MAX,
  MUSIC_STYLE_MAX,
  MUSIC_TITLE_MAX,
  resolveMusicMode,
} from "../../models/audio-capabilities";
import { DEFAULT_GATEWAY_LYRICS_MODEL, DEFAULT_GATEWAY_MUSIC_MODEL } from "../../models/media-kind";
import { defineTool } from "../define-tool";
import { missingToolRouteMessage, resolveToolBackend } from "../credentials";
import { getSecret } from "../secret-scope";
import { generateGatewayLyrics, generateGatewayMusic, generateGatewaySpeech } from "./gateway-audio";

const MISSING_MUSIC_ROUTE = "Add a Toko Token gateway key in Settings to generate music.";
const MISSING_SPEECH_ROUTE = "Add a Toko Token gateway key in Settings to generate speech.";

/**
 * Text to song. The gateway's only music backend is the Suno relay, so unlike `video_generate`
 * there is no second vendor to fall through to: a missing key is the only route failure there is.
 */
export const musicGenerateTool = defineTool({
  key: "music_generate",
  name: "Create music",
  description:
    "Create a song from a short description, or from your own lyrics with a style and a title. Uses the Toko Token gateway's async Suno relay (POST /suno/submit/music, then poll). Returns one entry per take.",
  capability: "music_gen",
  schema: z.object({
    prompt: z.string().min(1).max(MUSIC_PROMPT_MAX).optional().describe("What the song should be, when the model writes the lyrics"),
    lyrics: z.string().min(1).max(MUSIC_LYRICS_MAX).optional().describe("Your own lyrics; switches the job to custom mode"),
    style: z.string().max(MUSIC_STYLE_MAX).optional().describe("Genre / style tags, e.g. 'lo-fi, mellow, rhodes'"),
    title: z.string().max(MUSIC_TITLE_MAX).optional().describe("Track title, custom mode only"),
    instrumental: z.boolean().optional().describe("Render with no vocals"),
    model: z.string().min(1).optional().describe("Optional catalog music model id"),
  }),
  execute: async ({ prompt, lyrics, style, title, instrumental, model }) => {
    const route = resolveToolBackend("music_gen");
    if (!route.ready || !route.envVar) {
      return { success: false, error: missingToolRouteMessage(route, MISSING_MUSIC_ROUTE) };
    }
    const apiKey = getSecret(route.envVar);
    if (!apiKey) {
      return { success: false, error: `${route.envVar} is not set.` };
    }
    const chosen = model || getSecret("MUSIC_GEN_MODEL") || DEFAULT_GATEWAY_MUSIC_MODEL;
    const mode = resolveMusicMode(chosen, lyrics?.trim() ? "custom" : "describe");
    if (mode === "describe" && !prompt?.trim()) {
      return { success: false, error: "Describe the song, or supply lyrics." };
    }
    try {
      const generated = await generateGatewayMusic({
        baseUrl: getSecret("OPENAI_BASE_URL") || resolvedGatewayBaseUrl(),
        apiKey,
        model: chosen,
        mode,
        prompt,
        lyrics,
        style,
        title,
        instrumental,
      });
      return {
        success: true,
        backend: route.backend,
        tracks: generated.tracks,
        model: generated.model,
        mode,
        prompt: mode === "custom" ? lyrics : prompt,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Music generation failed" };
    }
  },
});

/** Lyrics only. Cheap, and the usual first step before a custom-mode `music_generate`. */
export const lyricsWriteTool = defineTool({
  key: "lyrics_write",
  name: "Write lyrics",
  description:
    "Write song lyrics from a short description, using the gateway's Suno lyrics relay (POST /suno/submit/lyrics, then poll). Returns text you can pass back as music_generate's lyrics.",
  capability: "music_gen",
  schema: z.object({
    prompt: z.string().min(1).max(MUSIC_PROMPT_MAX).describe("What the lyrics should be about"),
    model: z.string().min(1).optional().describe("Optional catalog lyrics model id"),
  }),
  execute: async ({ prompt, model }) => {
    const route = resolveToolBackend("music_gen");
    if (!route.ready || !route.envVar) {
      return { success: false, error: missingToolRouteMessage(route, MISSING_MUSIC_ROUTE) };
    }
    const apiKey = getSecret(route.envVar);
    if (!apiKey) {
      return { success: false, error: `${route.envVar} is not set.` };
    }
    try {
      const written = await generateGatewayLyrics({
        baseUrl: getSecret("OPENAI_BASE_URL") || resolvedGatewayBaseUrl(),
        apiKey,
        model: model || getSecret("LYRICS_MODEL") || DEFAULT_GATEWAY_LYRICS_MODEL,
        prompt,
      });
      return { success: true, backend: route.backend, text: written.text, title: written.title, model: written.model };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Lyrics generation failed" };
    }
  },
});

/**
 * Text to speech over `POST /v1/audio/speech`.
 *
 * No live id on this gateway reaches it today — the one TTS entry is realtime-only — so the caller
 * is expected to check `speechReachable` first and never offer the control. The tool still refuses
 * honestly rather than assuming a model id, because a guessed id bills nothing and explains nothing.
 */
export const speechGenerateTool = defineTool({
  key: "speech_generate",
  name: "Read text aloud",
  description:
    "Turn text into spoken audio through the gateway's OpenAI-compatible POST /v1/audio/speech. Requires a non-realtime text-to-speech model in the live catalog.",
  capability: "speech_gen",
  schema: z.object({
    text: z.string().min(1).max(4_000).describe("The words to read"),
    model: z.string().min(1).describe("Catalog text-to-speech model id"),
    voice: z.string().min(1).optional().describe("Voice name the model accepts"),
    format: z.enum(["mp3", "wav", "opus"]).optional().describe("Output container"),
  }),
  execute: async ({ text, model, voice, format }) => {
    const route = resolveToolBackend("speech_gen");
    if (!route.ready || !route.envVar) {
      return { success: false, error: missingToolRouteMessage(route, MISSING_SPEECH_ROUTE) };
    }
    const apiKey = getSecret(route.envVar);
    if (!apiKey) {
      return { success: false, error: `${route.envVar} is not set.` };
    }
    try {
      const spoken = await generateGatewaySpeech({
        baseUrl: getSecret("OPENAI_BASE_URL") || resolvedGatewayBaseUrl(),
        apiKey,
        model,
        text,
        voice,
        format,
      });
      return { success: true, backend: route.backend, audio: spoken.url, model: spoken.model };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Speech generation failed" };
    }
  },
});
