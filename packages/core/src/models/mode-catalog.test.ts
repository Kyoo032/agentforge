import { describe, expect, it } from "vitest";
import {
  CHAT_CATALOG_MODES,
  OWN_CATALOG_MODES,
  isChatCatalogMode,
  modelsForMode,
  type ModelCatalogWire,
} from "./mode-catalog";
import type { JobMode } from "./mode-defaults";

const row = (id: string) => ({ id });

describe("modelsForMode", () => {
  const wire: ModelCatalogWire<{ id: string }> = {
    models: [row("chat-a"), row("chat-b")],
    modes: { image: [row("img-a")], embedding: [row("emb-a")], video: [] },
  };

  it("hands every chat-shaped mode the one chat catalogue", () => {
    for (const mode of CHAT_CATALOG_MODES) {
      expect(modelsForMode(wire, mode), mode).toBe(wire.models);
    }
  });

  it("reads a media mode from its own list and never falls back to the chat catalogue", () => {
    expect(modelsForMode(wire, "image")).toEqual([row("img-a")]);
    expect(modelsForMode(wire, "embedding")).toEqual([row("emb-a")]);
    // An empty list the host sent is an answer, not a gap to fill.
    expect(modelsForMode(wire, "video")).toEqual([]);
    // Absent, and not chat-shaped: empty, so an image request is never offered a chat model.
    expect(modelsForMode(wire, "audio")).toEqual([]);
  });

  it("lets a list the host sent for a chat-shaped mode win over the catalogue", () => {
    const own = { models: [row("chat-a")], modes: { legal: [row("legal-only")] } };
    expect(modelsForMode(own, "legal")).toEqual([row("legal-only")]);
    expect(modelsForMode(own, "documents")).toEqual([row("chat-a")]);
  });

  it("tolerates a missing or malformed answer", () => {
    expect(modelsForMode(null, "documents")).toEqual([]);
    expect(modelsForMode(undefined, "chat")).toEqual([]);
    expect(modelsForMode({}, "research")).toEqual([]);
    expect(modelsForMode({ models: null, modes: null }, "data")).toEqual([]);
  });
});

describe("the mode lists", () => {
  it("covers every JobMode, so a new job mode cannot silently lose its picker", () => {
    const jobModes: JobMode[] = [
      "documents",
      "research",
      "presentations",
      "finance",
      "data",
      "market",
      "legal",
      "meeting",
    ];
    for (const mode of jobModes) {
      expect(isChatCatalogMode(mode), mode).toBe(true);
    }
  });

  it("keeps the two lists disjoint", () => {
    for (const mode of OWN_CATALOG_MODES) {
      expect(isChatCatalogMode(mode), mode).toBe(false);
    }
  });
});
