import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  usageModeFromRunPrefix,
  type PricingCatalog,
  type RuntimeEvent,
  type TenantContext,
  type UsageMode,
} from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { rememberJobUsage } from "./job-usage";
import { createUsageStore, setUsageStoreForTests, type UsageStore } from "./tenant-usage";
import {
  priceImageUsage,
  priceJobUsage,
  priceTokenUsage,
  priceVideoUsage,
  recordChatRunUsage,
  recordImageUsage,
  recordMusicUsage,
  recordTokenUsage,
  recordTranscriptionUsage,
  recordVideoUsage,
} from "./usage-record";

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-a",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "owner",
};

/**
 * A catalog shaped like the gateway's, with one per-token model, one flat per-call model and one
 * tiered model the host is not allowed to price.
 */
const catalog: PricingCatalog = {
  models: [
    { modelName: "gpt-5.6-sol", quotaType: 0, modelRatio: 1, completionRatio: 3, modelPrice: 0 },
    { modelName: "flat-call-model", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.02 },
    {
      modelName: "tiered-model",
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: 0,
      billingMode: "tiered_expr",
    },
  ],
  groupRatio: {},
};

function completed(model: string, inputTokens = 100, outputTokens = 40): RuntimeEvent {
  return { type: "run.completed", runId: "run-1", usage: { model, inputTokens, outputTokens } } as RuntimeEvent;
}

describe("usage recording", () => {
  let db: Database.Database;
  let store: UsageStore;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    store = createUsageStore(db);
    setUsageStoreForTests(store);
  });

  afterEach(() => {
    setUsageStoreForTests(null);
    db.close();
  });

  describe("every mode that calls the gateway leaves exactly one row", () => {
    // The token modes, as `usageModeFromRunPrefix` resolves them from the real `runPrefix` values.
    const TOKEN_MODES: UsageMode[] = [
      "chat",
      "documents",
      "presentations",
      "research",
      "data",
      "finance",
      "market",
      "legal",
      "knowledge",
      "edit",
    ];

    for (const mode of TOKEN_MODES) {
      it(`records ${mode} in tokens, against the tenant`, () => {
        const row = recordTokenUsage(
          tenant,
          { model: "gpt-5.6-sol", inputTokens: 100, outputTokens: 40 },
          { mode, catalog, runId: `${mode}-run` },
        );
        expect(row).not.toBeNull();

        const rows = store.list(tenant);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          tenantId: "local-tenant",
          organizationId: "org-a",
          userId: "user-1",
          mode,
          unit: "tokens",
          quantity: 140,
          inputTokens: 100,
          outputTokens: 40,
          runId: `${mode}-run`,
        });
        expect(rows[0]?.costUsdMicros).toBeGreaterThan(0);
      });
    }

    it("records an image in images, priced from the repo's list table", () => {
      // seedream-4.5 is $0.04 per image in packages/core/src/models/media-pricing.ts.
      const row = recordImageUsage(tenant, { model: "seedream-4.5", count: 1, aspect: "square" });
      expect(row).toMatchObject({ mode: "images", unit: "images", quantity: 1, costUsdMicros: 40_000 });

      const rows = store.list(tenant);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tenantId: "local-tenant", mode: "images", unit: "images" });
    });

    it("records a music job in jobs — one charge, however many takes come back", () => {
      // Suno has no vendor list price, so the only figure is the gateway's flat per-call rate.
      const catalog: PricingCatalog = {
        models: [{ modelName: "suno-v5", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.08 }],
        groupRatio: {},
      };
      const row = recordMusicUsage(tenant, { model: "suno-v5", catalog });
      expect(row).toMatchObject({ mode: "music", unit: "jobs", quantity: 1, costUsdMicros: 80_000 });
      expect(store.list(tenant)).toHaveLength(1);
    });

    it("records a music job the gateway catalog cannot price yet", () => {
      expect(recordMusicUsage(tenant, { model: "suno-v5", catalog: null })).toMatchObject({
        unit: "jobs",
        quantity: 1,
        costUsdMicros: null,
        unpricedReason: "catalog_unavailable",
      });
      expect(recordMusicUsage(tenant, { model: "suno-v5", catalog })).toMatchObject({
        unit: "jobs",
        costUsdMicros: null,
        unpricedReason: "no_list_price",
      });
      expect(store.list(tenant)).toHaveLength(2);
    });

    it("records a meeting transcription in seconds of audio, under the meetings mode", () => {
      // The recording, not the transcript: a recogniser bills for the audio it was handed, and the
      // number of chunks `extractMeetingAudio` split it into is a host detail that must not reach
      // the bill.
      const row = recordTranscriptionUsage(tenant, { model: "mimo-v2.5-asr", seconds: 754.2 });
      expect(row).toMatchObject({
        mode: "meetings",
        unit: "seconds",
        quantity: 755,
        costUsdMicros: null,
        unpricedReason: "no_list_price",
      });
      expect(store.list(tenant)).toHaveLength(1);
      expect(store.list(tenant)[0]).toMatchObject({ tenantId: "local-tenant", organizationId: "org-a" });
    });

    it("keeps meeting minutes and their translation in tokens, under the same mode", () => {
      // One meeting can leave three rows of two units. Only `costUsdMicros` adds up across them.
      rememberJobUsage(completed("gpt-5.6-sol"), {
        tenant,
        mode: usageModeFromRunPrefix("meeting-minutes"),
        runId: "meeting-minutes-1",
      });
      rememberJobUsage(completed("gpt-5.6-sol"), {
        tenant,
        mode: usageModeFromRunPrefix("meeting-translate"),
        runId: "meeting-translate-1",
      });
      recordTranscriptionUsage(tenant, { model: "mimo-v2.5-asr", seconds: 60 });

      const rows = store.list(tenant);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.mode === "meetings")).toBe(true);
      expect(rows.map((row) => row.unit).sort()).toEqual(["seconds", "tokens", "tokens"]);
    });

    it("records a video in seconds, at the per-second list price times the clip length", () => {
      // veo-3.1-lite is $0.05 per second at 720p; an 8 s clip is $0.40.
      const row = recordVideoUsage(tenant, { model: "veo-3.1-lite", seconds: 8, resolution: "720p" });
      expect(row).toMatchObject({ mode: "videos", unit: "seconds", quantity: 8, costUsdMicros: 400_000 });
      expect(store.list(tenant)).toHaveLength(1);
    });
  });

  describe("an unpriced call is still a row", () => {
    it("records a model the catalog does not list, with the reason", () => {
      const row = recordTokenUsage(
        tenant,
        { model: "model-nobody-catalogued", inputTokens: 900, outputTokens: 100 },
        { mode: "documents", catalog },
      );
      expect(row).toMatchObject({
        unit: "tokens",
        quantity: 1_000,
        costUsdMicros: null,
        unpricedReason: "model_not_in_catalog",
      });
      // The row exists, which is the difference between undercounting visibly and invisibly.
      expect(store.list(tenant)).toHaveLength(1);
      expect(store.totals(tenant)).toMatchObject({
        costUsdMicros: 0,
        pricedCount: 0,
        unpricedCount: 1,
        unpricedByReason: { model_not_in_catalog: 1 },
      });
    });

    it("records a tiered-billing model the host must not price", () => {
      const row = recordTokenUsage(
        tenant,
        { model: "tiered-model", inputTokens: 10, outputTokens: 5 },
        { mode: "research", catalog },
      );
      expect(row).toMatchObject({ costUsdMicros: null, unpricedReason: "tiered_billing" });
      expect(store.list(tenant)).toHaveLength(1);
    });

    it("records a run with no catalog in memory, so a later pass can price it", () => {
      const row = recordTokenUsage(
        tenant,
        { model: "gpt-5.6-sol", inputTokens: 10, outputTokens: 5 },
        { mode: "data", catalog: null },
      );
      expect(row).toMatchObject({ unit: "tokens", quantity: 15, unpricedReason: "catalog_unavailable" });
      expect(store.list(tenant)).toHaveLength(1);
    });

    it("records a run whose token counts the runtime could not attribute", () => {
      const row = recordTokenUsage(
        tenant,
        { model: "gpt-5.6-sol", inputTokens: 0, outputTokens: 0, unknown: true },
        { mode: "chat", catalog },
      );
      expect(row).toMatchObject({ unit: "tokens", quantity: 0, unpricedReason: "usage_unknown" });
      expect(store.list(tenant)).toHaveLength(1);
    });

    it("records a media model nobody has transcribed a list price for", () => {
      expect(recordImageUsage(tenant, { model: "brand-new-image-model" })).toMatchObject({
        unit: "images",
        quantity: 1,
        costUsdMicros: null,
        unpricedReason: "no_list_price",
      });
      expect(recordVideoUsage(tenant, { model: "brand-new-video-model", seconds: 6 })).toMatchObject({
        unit: "seconds",
        quantity: 6,
        costUsdMicros: null,
        unpricedReason: "no_list_price",
      });
      expect(store.list(tenant)).toHaveLength(2);
    });
  });

  describe("the job and chat entry points", () => {
    it("rememberJobUsage writes a tenanted row instead of the old global file", () => {
      rememberJobUsage(completed("gpt-5.6-sol"), { tenant, mode: "documents", runId: "document-7" });
      expect(store.list(tenant)).toHaveLength(1);
      expect(store.list(tenant)[0]).toMatchObject({
        tenantId: "local-tenant",
        mode: "documents",
        unit: "tokens",
        runId: "document-7",
      });
    });

    it("rememberJobUsage ignores an event that is not a completed run with usage", () => {
      rememberJobUsage({ type: "assistant.delta", text: "hi" } as RuntimeEvent, { tenant, mode: "documents" });
      rememberJobUsage({ type: "run.completed", runId: "r" } as RuntimeEvent, { tenant, mode: "documents" });
      expect(store.list(tenant)).toHaveLength(0);
    });

    it("recordChatRunUsage writes one row for the call that finished the run", () => {
      const usage = { model: "gpt-5.6-sol", inputTokens: 100, outputTokens: 40 };
      expect(recordChatRunUsage(tenant, "run-1", true, usage)).not.toBeNull();
      // The watchdog and the client abort also call `finishRun`; only one of them gets `true`.
      expect(recordChatRunUsage(tenant, "run-1", false, usage)).toBeNull();
      expect(recordChatRunUsage(tenant, "run-1", true, null)).toBeNull();
      expect(store.list(tenant)).toHaveLength(1);
      expect(store.list(tenant)[0]).toMatchObject({ mode: "chat", unit: "tokens", runId: "run-1" });
    });
  });

  describe("pricing", () => {
    it("prices a per-token model and a flat per-call model in integer micros", () => {
      expect(priceTokenUsage({ model: "gpt-5.6-sol", inputTokens: 100, outputTokens: 40 }, catalog)).toMatchObject({
        costUsdMicros: expect.any(Number),
      });
      // quotaType 1 is a flat charge per call: $0.02 at the default group ratio of 1.
      expect(priceTokenUsage({ model: "flat-call-model", inputTokens: 1, outputTokens: 1 }, catalog)).toEqual({
        costUsdMicros: 20_000,
      });
    });

    it("prices media from the list table and says so when there is none", () => {
      expect(priceImageUsage("seedream-4.5", 3)).toEqual({ costUsdMicros: 120_000 });
      expect(priceVideoUsage("veo-3.1-lite", 4, "720p")).toEqual({ costUsdMicros: 200_000 });
      expect(priceImageUsage("nope", 1)).toEqual({ costUsdMicros: null, unpricedReason: "no_list_price" });
      // A flat-rate job with no catalog is `catalog_unavailable`, not `no_list_price`: one is
      // fixable by a warm cache, the other is not.
      expect(priceJobUsage("suno-v5", 1, null)).toEqual({
        costUsdMicros: null,
        unpricedReason: "catalog_unavailable",
      });
      expect(priceVideoUsage("nope", 4)).toEqual({ costUsdMicros: null, unpricedReason: "no_list_price" });
    });
  });

  describe("usageModeFromRunPrefix covers every runPrefix in the repo", () => {
    // Each of these is a literal `runPrefix:` passed at a real job call site. If a new mode is
    // added without a prefix this function recognises, its spend lands under `other` rather than
    // vanishing — but it should land under its own name, so this list is the check.
    const CASES: Array<[string, UsageMode]> = [
      ["document", "documents"],
      ["document-section", "documents"],
      ["presentation", "presentations"],
      ["presentation-slide", "presentations"],
      ["research", "research"],
      ["data", "data"],
      ["finance", "finance"],
      ["finance-section", "finance"],
      ["finance-repair", "finance"],
      ["finance-ratios-buckets", "finance"],
      ["market", "market"],
      ["market-team", "market"],
      ["market-section", "market"],
      ["legal", "legal"],
      ["knowledge-brain", "knowledge"],
      ["knowledge-verifier", "knowledge"],
      ["edit", "edit"],
      ["music", "music"],
      ["meeting-minutes", "meetings"],
      ["meeting-translate", "meetings"],
      ["chat", "chat"],
      ["enhance", "other"],
      ["", "other"],
    ];

    for (const [prefix, mode] of CASES) {
      it(`${prefix || "(empty)"} → ${mode}`, () => {
        expect(usageModeFromRunPrefix(prefix)).toBe(mode);
      });
    }
  });
});
