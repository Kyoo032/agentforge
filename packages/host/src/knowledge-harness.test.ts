import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKnowledgeMap, type KnowledgeModels, type TenantContext } from "@agentforge/core";
import { addPastedSource, deleteSource, knowledgeInjection } from "./knowledge";
import { getKnowledgeMap, mapKnowledge, takeKnowledgeMapText } from "./knowledge-map";
import { withRunContext } from "./run-context";

const MODELS: KnowledgeModels = {
  embeddingModel: "text-embedding-3-small",
  brainModel: "gpt-5.6-luna",
  verifierModel: "deepseek-v4-flash",
};

const MAP_JSON = JSON.stringify({
  overview: "Desk",
  topics: [{ title: "Vendors", summary: "Spend", sourceIds: ["s1"], verdict: "supported" }],
  gaps: [],
  ready: true,
});

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-knowledge-harness",
    workspaceId: `ws-harness-${crypto.randomUUID()}`,
    userId: "user-knowledge-harness",
    role: "owner",
  };
}

describe("knowledge map text", () => {
  it("asks once more when the first text is not a map", async () => {
    const seen: string[] = [];
    const map = await takeKnowledgeMapText(
      async () => {
        seen.push("ask");
        return seen.length === 1 ? "not json" : MAP_JSON;
      },
      (raw) => parseKnowledgeMap(raw, MODELS, "live"),
    );
    expect(seen).toEqual(["ask", "ask"]);
    expect(map?.topics[0]?.title).toBe("Vendors");
    expect(map?.source).toBe("live");
  });

  it("keeps the first map and does not ask again", async () => {
    let calls = 0;
    const map = await takeKnowledgeMapText(
      async () => {
        calls += 1;
        return MAP_JSON;
      },
      (raw) => parseKnowledgeMap(raw, MODELS, "live"),
    );
    expect(calls).toBe(1);
    expect(map?.overview).toBe("Desk");
  });
});

describe("knowledge retrieve miss and honest map", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-knowledge-harness-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    if (previousRuntime === undefined) {
      delete process.env.AGENTFORGE_RUNTIME;
    } else {
      process.env.AGENTFORGE_RUNTIME = previousRuntime;
    }
    if (previousSettings === undefined) {
      delete process.env.AGENTFORGE_SETTINGS_PATH;
    } else {
      process.env.AGENTFORGE_SETTINGS_PATH = previousSettings;
    }
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("says the question is not in the saved notes", async () => {
    const ctx = tenant();
    const missed = await knowledgeInjection(ctx, "where is the spare key kept");
    expect(missed.prompt).toContain("No saved source matched this question.");
    expect(missed.prompt).toContain("Do not invent a citation or a source name.");
    expect(missed.prompt).not.toContain("[1]");
    expect(missed.chunks).toEqual([]);

    const indonesian = await withRunContext(
      { threadId: "t", agentId: "knowledge", locale: "id" },
      () => knowledgeInjection(ctx, "di mana kunci cadangan disimpan"),
    );
    expect(indonesian.prompt).toContain("Tidak ada sumber tersimpan");
    expect(indonesian.prompt).not.toContain("No saved source matched");

    const empty = await knowledgeInjection(ctx, "   ");
    expect(empty.prompt).not.toContain("No saved source matched");
    expect(empty.prompt).not.toContain("Tidak ada sumber tersimpan");
  });

  it("returns the saved passage and does not add the miss line", async () => {
    const ctx = tenant();
    const token = `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await addPastedSource(ctx, "Planted notes", `The internal code name is ${token}.`);
    const injected = await knowledgeInjection(ctx, token);
    expect(injected.prompt).toContain(token);
    expect(injected.prompt).toContain("[1]");
    expect(injected.prompt).not.toContain("Do not invent a citation");
    expect(injected.chunks.length).toBeGreaterThan(0);
  });

  it("drops a deleted source from the saved map", async () => {
    const ctx = tenant();
    const source = await addPastedSource(ctx, "Vendor spend is concentrated in one supplier.", "Spend notes");
    const mapped = await mapKnowledge(ctx);
    expect(mapped.topics.some((topic) => topic.sourceIds.includes(source.id))).toBe(true);

    expect(deleteSource(ctx, source.id)).toBe(true);
    const after = getKnowledgeMap(ctx);
    expect(after).not.toBeNull();
    expect(after?.topics.some((topic) => topic.sourceIds.includes(source.id))).toBe(false);
    expect(after?.ready).toBe(false);
  });
});
