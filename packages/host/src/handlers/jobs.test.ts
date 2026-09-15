import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatModel, MediaPrice, PricingCatalog } from "@agentforge/core";
import { attachMediaPrices, gatewayFlatPrice } from "../media-price";
import type { HostRequest, HostResult } from "../types";

// Isolation: point the data dir (database + stub media rows) at a temp folder BEFORE the router is imported.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-jobs-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

type StudioListBody = {
  items: unknown[];
  models: { id: string; price: MediaPrice | null }[];
  defaultModel: string;
  ready: boolean;
};

function request(method: string, path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...extra };
}

async function json(method: string, path: string): Promise<{ status: number; body: unknown }> {
  const result = await dispatch(request(method, path));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: result.body };
}

const CATALOG: PricingCatalog = {
  models: [
    { modelName: "mj_imagine", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.05 },
    { modelName: "mj_free", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0 },
    {
      modelName: "seedance-9.9",
      quotaType: 1,
      modelRatio: 0,
      completionRatio: 0,
      modelPrice: 0.5,
      billingMode: "tiered_expr",
    },
    { modelName: "some-chat-model", quotaType: 0, modelRatio: 2, completionRatio: 3, modelPrice: 0 },
  ],
  groupRatio: {},
};

const NOW = new Date("2026-09-15T00:00:00.000Z");

describe("studio model prices", () => {
  it("prefers the curated list price over the gateway catalog", () => {
    const rows = attachMediaPrices([model("gpt-image-2")], "image", CATALOG, undefined, NOW);
    expect(rows[0].price?.origin).toBe("list");
    expect(rows[0].price?.vendor).toBe("OpenAI");
    expect(rows[0].price?.tiers.medium).toBe(0.032);
  });

  it("falls back to a flat gateway per-call price for images", () => {
    const price = gatewayFlatPrice(CATALOG, "mj_imagine", "image", undefined, NOW);
    expect(price).toMatchObject({
      origin: "gateway",
      unit: "image",
      confidence: "medium",
      defaultTier: "default",
      checkedAt: "2026-09-15",
    });
    expect(price?.tiers.default).toBeCloseTo(0.05, 6);
    expect(price?.source).toMatch(/^https:\/\/.+\/api\/pricing$/);
  });

  it("refuses to invent a price from a token-billed, free or tiered catalog row", () => {
    expect(gatewayFlatPrice(CATALOG, "mj_free", "image", undefined, NOW)).toBeNull();
    expect(gatewayFlatPrice(CATALOG, "seedance-9.9", "image", undefined, NOW)).toBeNull();
    expect(gatewayFlatPrice(CATALOG, "some-chat-model", "image", undefined, NOW)).toBeNull();
    expect(gatewayFlatPrice(CATALOG, "not-in-catalog", "image", undefined, NOW)).toBeNull();
  });

  it("never turns a flat per-call rate into a per-second video price", () => {
    expect(gatewayFlatPrice(CATALOG, "mj_imagine", "second", undefined, NOW)).toBeNull();
    expect(attachMediaPrices([model("mj_video")], "second", CATALOG, undefined, NOW)[0].price).toBeNull();
  });

  it("returns null with no catalog cached and leaves the input models untouched", () => {
    const input = [model("mj_imagine")];
    const rows = attachMediaPrices(input, "image", null, undefined, NOW);
    expect(rows[0].price).toBeNull();
    expect(input[0]).not.toHaveProperty("price");
  });
});

function model(id: string): ChatModel {
  return { id, label: id, provider: "openai", inputModalities: ["text"] };
}

describe("studio job handlers via the router", () => {
  beforeAll(async () => {
    ({ dispatch } = await import("../router"));
  }, 60_000);

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("carries a defaultModel and a price field on every image model", async () => {
    const response = await json("GET", "/api/v1/images");
    expect(response.status).toBe(200);
    const body = response.body as StudioListBody;
    expect(typeof body.defaultModel).toBe("string");
    expect(body.defaultModel.length).toBeGreaterThan(0);
    expect(Array.isArray(body.models)).toBe(true);
    for (const row of body.models) {
      expect(row).toHaveProperty("price");
      if (row.price) {
        expect(row.price.unit).toBe("image");
        expect(row.price.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.price.tiers[row.price.defaultTier]).toBeGreaterThan(0);
      }
    }
  });

  it("carries a defaultModel and a per-second price field on every video model", async () => {
    const response = await json("GET", "/api/v1/videos");
    expect(response.status).toBe(200);
    const body = response.body as StudioListBody;
    expect(typeof body.defaultModel).toBe("string");
    expect(body.defaultModel.length).toBeGreaterThan(0);
    for (const row of body.models) {
      expect(row).toHaveProperty("price");
      if (row.price) {
        expect(row.price.unit).toBe("second");
        expect(row.price.origin).toBe("list");
      }
    }
  });
});
