import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHAT_CATALOG_MODES, OWN_CATALOG_MODES, modelsForMode } from "@agentforge/core/mode-catalog";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "../types";

// Isolation: database, settings and the model cache all live in the data dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-models-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.AGENTFORGE_MODELS_CACHE_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;
const realFetch = globalThis.fetch;

type Modality = "text" | "image" | "video";
const TEXT: Modality[] = ["text"];

/** The desk this suite reproduces carried 126 chat models; the size assertions below depend on a big list. */
const CHAT_COUNT = 126;

async function json(method: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await dispatch({ method, path, query: {}, params: {}, headers: {} });
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
}

const bytes = (value: unknown) => JSON.stringify(value).length;

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
  const { saveModelCache } = await import("../model-cache");
  const { resetCatalogMemo } = await import("../selectable-models");
  saveModelCache({
    openai: [
      ...Array.from({ length: CHAT_COUNT }, (_, index) => ({
        id: `acme-chat-${String(index).padStart(3, "0")}`,
        label: `Acme Chat ${index}`,
        provider: "openai" as const,
        inputModalities: ["text", "image"] as Modality[],
      })),
      { id: "gpt-image-2", label: "GPT Image 2", provider: "openai" as const, inputModalities: TEXT },
      { id: "grok-imagine-video", label: "Grok Imagine", provider: "openai" as const, inputModalities: TEXT },
      { id: "text-embedding-3-small", label: "Embed", provider: "openai" as const, inputModalities: TEXT },
    ],
  });
  resetCatalogMemo();
}, ROUTER_IMPORT_BUDGET_MS);

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/v1/models sends the catalogue once", () => {
  it("carries the chat catalogue as `models` and no per-mode copy of it", async () => {
    const { status, body } = await json("GET", "/api/v1/models");
    expect(status).toBe(200);
    const models = body.models as Array<{ id: string }>;
    expect(models.filter((model) => model.id.startsWith("acme-chat-"))).toHaveLength(CHAT_COUNT);

    const modes = body.modes as Record<string, unknown[]>;
    for (const mode of CHAT_CATALOG_MODES) {
      expect(modes, `modes.${mode} would repeat the chat catalogue`).not.toHaveProperty(mode);
    }
    // What it does carry is the lists that are genuinely different.
    expect(Object.keys(modes).sort()).toEqual([...OWN_CATALOG_MODES].sort());
    expect((modes.image as Array<{ id: string }>).map((model) => model.id)).toContain("gpt-image-2");
    expect((modes.video as Array<{ id: string }>).map((model) => model.id)).toContain("grok-imagine-video");
    expect((modes.embedding as Array<{ id: string }>).map((model) => model.id)).toContain("text-embedding-3-small");
  });

  it("is barely larger than one copy of the chat list, where it was nine", async () => {
    const { body } = await json("GET", "/api/v1/models");
    const once = bytes(body.models);
    expect(once).toBeGreaterThan(20_000);
    // `models` + the small media lists + `defaults`. Nine copies would be about 9x.
    expect(bytes(body)).toBeLessThan(once * 1.5);
  });

  it("still resolves every mode's models, through the one rule", async () => {
    const { body } = await json("GET", "/api/v1/models");
    const wire = body as { models: Array<{ id: string }>; modes: Record<string, Array<{ id: string }>> };
    for (const mode of CHAT_CATALOG_MODES) {
      expect(modelsForMode(wire, mode), mode).toHaveLength(wire.models.length);
    }
    expect(modelsForMode(wire, "image").map((model) => model.id)).toContain("gpt-image-2");
    expect((body.defaults as Record<string, string>).documents).toBeTruthy();
    expect(typeof body.defaultModel).toBe("string");
  });

  it("answers a refresh with the same shape plus the probe summary", async () => {
    // No key: a stub desk never calls the gateway; only the models.dev registry refresh runs, and it
    // must not reach the network from a test.
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const { status, body } = await json("POST", "/api/v1/models");
    expect(status).toBe(200);
    expect(body).toHaveProperty("probe");
    const modes = body.modes as Record<string, unknown>;
    for (const mode of CHAT_CATALOG_MODES) {
      expect(modes).not.toHaveProperty(mode);
    }
    expect((body.models as unknown[]).length).toBeGreaterThanOrEqual(CHAT_COUNT);
  });
});

describe("GET /api/v1/settings does not carry the catalogue", () => {
  it("has no `modes` and stays smaller than one copy of the chat list", async () => {
    const { status, body } = await json("GET", "/api/v1/settings");
    expect(status).toBe(200);
    expect(body).not.toHaveProperty("modes");
    // The per-mode default ids are what Settings reads, and they stay.
    expect(body.defaults).toMatchObject({ chat: expect.any(String), documents: expect.any(String) });
    const catalogue = bytes((await json("GET", "/api/v1/models")).body.models);
    expect(bytes(body)).toBeLessThan(catalogue);
    expect(bytes(body)).toBeLessThan(40_000);
  });

  it("answers a save without the catalogue too", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const result = await dispatch({
      method: "POST",
      path: "/api/v1/settings",
      query: {},
      params: {},
      headers: {},
      body: { locale: "en" },
    });
    if (result.type !== "json") {
      throw new Error(`expected json, got ${result.type}`);
    }
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("modes");
    expect(body.defaults).toBeTruthy();
    expect(bytes(body)).toBeLessThan(40_000);
  });
});
