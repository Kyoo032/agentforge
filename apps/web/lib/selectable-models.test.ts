import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatModel } from "@agentforge/core";
import { modeCatalogPayload } from "./selectable-models";

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
    ]);

    expect(payload.modes.chat.map((item) => item.id)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "claude-sonnet-5",
      "deepseek-v4-flash",
      "glm-5.2-fast-preview",
    ]);
    expect(payload.modes.documents.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.research.map((item) => item.id)).toEqual(payload.modes.chat.map((item) => item.id));
    expect(payload.modes.presentations.map((item) => item.id)).toEqual(
      payload.modes.chat.map((item) => item.id),
    );
    expect(payload.modes.image.map((item) => item.id)).toEqual(["mj_imagine", "gpt-image-2"]);
    expect(payload.modes.video.map((item) => item.id)).toEqual(["mj_video", "grok-imagine-video", "seedance-2.5"]);
    expect(payload.modes.audio.map((item) => item.id)).toEqual(["whisper-1"]);

    expect(payload.defaults.chat).toBe("gpt-5.6-luna");
    expect(payload.defaults.documents).toBe("deepseek-v4-flash");
    expect(payload.defaults.research).toBe("gpt-5.6-luna");
    expect(payload.defaults.presentations).toBe("glm-5.2-fast-preview");
    expect(payload.defaults.image).toBe("gpt-image-2");
    expect(payload.defaults.video).toBe("grok-imagine-video");
  });

  it("falls job defaults back to the chat default when preferred ids are missing", () => {
    const payload = modeCatalogPayload([model("minimax-m3")]);
    expect(payload.defaults.documents).toBe(payload.defaults.chat);
    expect(payload.defaults.research).toBe(payload.defaults.chat);
    expect(payload.defaults.presentations).toBe(payload.defaults.chat);
  });
});
