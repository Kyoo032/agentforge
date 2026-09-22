import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RELAY_ONLY_MUSIC_MODEL_IDS, type ChatModel } from "@agentforge/core";
import {
  listCatalogModels,
  modeCatalogPayload,
  resetCatalogMemo,
  withRelayMusicModels,
} from "./selectable-models";

describe("listCatalogModels memo", () => {
  it("returns the memoized catalog until a cache file changes", () => {
    resetCatalogMemo();
    const first = listCatalogModels();
    const second = listCatalogModels();
    expect(second).toBe(first);
    resetCatalogMemo();
    const third = listCatalogModels();
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });
});

function model(id: string): ChatModel {
  return { id, label: id, provider: "openai", inputModalities: ["text"] };
}

describe("modeCatalogPayload", () => {
  let previousCache: string | undefined;
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "af-models-"));
    previousCache = process.env.AGENTFORGE_MODELS_CACHE_PATH;
    process.env.AGENTFORGE_MODELS_CACHE_PATH = join(cacheDir, "missing.json");
  });

  afterEach(() => {
    if (previousCache === undefined) {
      delete process.env.AGENTFORGE_MODELS_CACHE_PATH;
    } else {
      process.env.AGENTFORGE_MODELS_CACHE_PATH = previousCache;
    }
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("routes a mixed catalog into chat jobs and full media lists", () => {
    const payload = modeCatalogPayload([
      model("gpt-5.6-terra"),
      model("gpt-5.6-luna"),
      model("gpt-5.6-sol"),
      model("claude-sonnet-5"),
      model("deepseek-v4-flash"),
      model("glm-5.2-fast-preview"),
      model("mj_imagine"),
      model("gpt-image-2"),
      model("mj_video"),
      model("grok-imagine-video"),
      model("seedance-2.5"),
      model("whisper-1"),
      model("text-embedding-3-small"),
      model("text-embedding-3-large"),
    ]);

    expect(payload.modes.chat.map((item) => item.id)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "claude-sonnet-5",
      "glm-5.2-fast-preview",
      "deepseek-v4-flash",
    ]);
    expect(payload.modes.documents.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.research.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.presentations.map((item) => item.id)).toEqual(
      payload.modes.chat.map((item) => item.id),
    );
    expect(payload.modes.finance.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.data.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.market.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.image.map((item) => item.id)).toEqual(["mj_imagine", "gpt-image-2"]);
    expect(payload.modes.video.map((item) => item.id)).toEqual(["mj_video", "grok-imagine-video", "seedance-2.5"]);
    expect(payload.modes.audio.map((item) => item.id)).toEqual(["whisper-1"]);
    expect(payload.modes.embedding.map((item) => item.id)).toEqual([
      "text-embedding-3-small",
      "text-embedding-3-large",
    ]);

    expect(payload.defaults.chat).toBe("gpt-5.6-luna");
    expect(payload.defaults.documents).toBe("deepseek-v4-flash");
    expect(payload.defaults.research).toBe("gpt-5.6-luna");
    expect(payload.defaults.presentations).toBe("glm-5.2-fast-preview");
    expect(payload.defaults.finance).toBe("deepseek-v4-flash");
    expect(payload.defaults.data).toBe("gpt-5.6-luna");
    expect(payload.defaults.market).toBe("deepseek-v4-flash");
    expect(payload.defaults.legal).toBe("gpt-5.6-sol");
    expect(payload.defaults.image).toBe("gpt-image-2");
    expect(payload.defaults.video).toBe("grok-imagine-video");
    expect(payload.defaults.embedding).toBe("text-embedding-3-small");
    expect(payload.defaults.knowledgeBrain).toBe("gpt-5.6-luna");
    expect(payload.defaults.knowledgeVerifier).toBe("gpt-5.6-luna");
  });

  /**
   * Regression, 2026-09-21: `modes.music` came back `[]` on the owner's live desk while
   * `defaults.music` said `suno_music`, because the gateway's `/v1/models` never lists a relay task
   * model. A mode list that cannot contain its own default is the bug the owner saw as a dead picker.
   */
  it("keeps the gateway's relay music model in modes.music even when the catalog lists none", () => {
    const payload = modeCatalogPayload([model("gpt-5.6-luna"), model("gpt-image-2")]);
    expect(payload.modes.music.map((item) => item.id)).toContain("suno_music");
    expect(payload.modes.music.map((item) => item.id)).toContain(payload.defaults.music);
  });

  it("does not list the relay music model twice when the catalog does serve it", () => {
    const payload = modeCatalogPayload([model("gpt-5.6-luna"), model("suno_music"), model("suno_lyrics")]);
    expect(payload.modes.music.map((item) => item.id)).toEqual(["suno_music"]);
    expect(payload.defaults.music).toBe("suno_music");
  });

  it("falls job defaults back to the chat default when preferred ids are missing", () => {
    const payload = modeCatalogPayload([model("minimax-m3")]);
    expect(payload.defaults.documents).toBe(payload.defaults.chat);
    expect(payload.defaults.research).toBe(payload.defaults.chat);
    expect(payload.defaults.presentations).toBe(payload.defaults.chat);
    expect(payload.defaults.finance).toBe(payload.defaults.chat);
    expect(payload.defaults.data).toBe(payload.defaults.chat);
    expect(payload.defaults.market).toBe(payload.defaults.chat);
    expect(payload.modes.embedding.map((item) => item.id)).toEqual(["text-embedding-3-small"]);
    expect(payload.defaults.embedding).toBe("text-embedding-3-small");
    expect(payload.defaults.knowledgeBrain).toBe(payload.defaults.chat);
    expect(payload.defaults.knowledgeVerifier).toBe(payload.defaults.chat);
  });
});

/**
 * The merge itself.
 *
 * A relay model is reachable without ever appearing in `GET /v1/models`, so the Music picker is the
 * live catalog *plus* a fixed list of relay ids. The rules that keep that honest: never mutate the
 * catalog it was handed, never duplicate an id the catalog already serves (the gateway's spelling
 * wins), and keep the catalog rows exactly as they came so their prices and curation survive.
 */
describe("withRelayMusicModels", () => {
  it("adds the relay model to an empty catalog", () => {
    const merged = withRelayMusicModels([]);
    expect(merged.map((item) => item.id)).toEqual([...RELAY_ONLY_MUSIC_MODEL_IDS]);
    expect(merged[0]?.label).toBe("suno_music");
  });

  it("keeps the catalog row when the gateway does list the id, whatever its case", () => {
    const catalog = [model("SUNO_music")];
    const merged = withRelayMusicModels(catalog);
    expect(merged.map((item) => item.id)).toEqual(["SUNO_music"]);
    expect(merged[0]).toBe(catalog[0]);
  });

  it("never mutates the list it was given", () => {
    const catalog = [model("lyria-2")];
    const merged = withRelayMusicModels(catalog);
    expect(catalog.map((item) => item.id)).toEqual(["lyria-2"]);
    expect(merged.map((item) => item.id)).toEqual(["lyria-2", "suno_music"]);
  });

  it("appends an explicit extra id, and ignores a blank one", () => {
    expect(withRelayMusicModels([], ["chirp-v4"]).map((item) => item.id)).toEqual(["chirp-v4"]);
    expect(withRelayMusicModels([model("suno_music")], ["  "]).map((item) => item.id)).toEqual(["suno_music"]);
    expect(withRelayMusicModels([model("suno_music")], ["suno_music"]).map((item) => item.id)).toEqual([
      "suno_music",
    ]);
  });
});
