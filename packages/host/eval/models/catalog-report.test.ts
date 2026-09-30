import { describe, expect, it } from "vitest";
import { buildCatalogReport, diffSnapshots, renderCatalogReport, snapshotOf, type CatalogSnapshot } from "./catalog-report";
import { preferenceLists } from "./lists";

const GENERATED = new Date("2026-09-30T10:00:00Z");
const source = { dataDir: "/desk", refreshed: false, probedAt: "2026-09-30T09:00:00Z" };

const models = (...ids: string[]) => ids.map((id) => ({ id }));

describe("preferenceLists", () => {
  const lists = preferenceLists();
  const byName = new Map(lists.map((list) => [list.name, list]));

  it("carries every list the product ranks or falls back by", () => {
    for (const name of [
      "CHAT_DEFAULT_PREFERENCES",
      "EVERYDAY_MODEL_IDS",
      "JOB_FALLBACK_TAIL",
      "JOB_MODE_PREFERENCES.documents",
      "JOB_MODE_PREFERENCES.research",
      "JOB_MODE_PREFERENCES.presentations",
      "JOB_MODE_PREFERENCES.finance",
      "JOB_MODE_PREFERENCES.data",
      "JOB_MODE_PREFERENCES.market",
      "JOB_MODE_PREFERENCES.legal",
      "JOB_MODE_PREFERENCES.meeting",
      "MEDIA.image",
      "MEDIA.video",
      "MEDIA.music",
      "MEDIA.lyrics",
      "MEDIA.speech",
      "MEDIA.embedding",
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
  });

  it("marks chat lists and media lists apart, because they are matched against different catalogues", () => {
    expect(byName.get("CHAT_DEFAULT_PREFERENCES")?.kind).toBe("chat");
    expect(byName.get("JOB_MODE_PREFERENCES.meeting")?.kind).toBe("chat");
    expect(byName.get("MEDIA.image")?.kind).toBe("media");
  });

  it("holds the same ids the product code holds", () => {
    expect(byName.get("CHAT_DEFAULT_PREFERENCES")?.ids[0]).toBe("gpt-6-luna");
    expect(byName.get("CHAT_DEFAULT_PREFERENCES")?.ids).toContain("gpt-5.6-luna");
    expect(byName.get("JOB_MODE_PREFERENCES.meeting")?.ids).toContain("gpt-6-sol");
    expect(byName.get("JOB_FALLBACK_TAIL")?.ids).toContain("deepseek-v4-1-flash");
    expect(byName.get("MEDIA.video")?.ids[0]).toBe("seedance-2.0");
    expect(byName.get("MEDIA.image")?.ids).toContain("gpt-image-2");
  });
});

describe("buildCatalogReport", () => {
  const list = { name: "PREFS", kind: "chat" as const, ids: ["gpt-5.6-luna", "Claude-Sonnet-5", "not-listed-anywhere", "brand-new-chat"] };
  const all = models("gpt-5.6-luna", "claude-sonnet-5", "brand-new-chat", "text-embedding-3-small", "gpt-image-2");

  it("says for every chat id which policy entry knows it, or UNKNOWN", () => {
    const report = buildCatalogReport({ generatedAt: GENERATED, models: all, lists: [list], source });
    const byId = new Map(report.chat.map((row) => [row.id, row]));
    expect(byId.get("gpt-5.6-luna")).toMatchObject({ policyKey: "gpt-5.6", known: true, wire: "responses" });
    expect(byId.get("claude-sonnet-5")).toMatchObject({ policyKey: "claude-5", known: true, wire: "anthropic_messages" });
    expect(byId.get("brand-new-chat")).toMatchObject({ policyKey: "UNKNOWN", known: false });
    expect(report.unknownChat).toEqual(["brand-new-chat"]);
  });

  it("leaves media and embedding ids out of the chat table", () => {
    const report = buildCatalogReport({ generatedAt: GENERATED, models: all, lists: [list], source });
    expect(report.chat.map((row) => row.id)).not.toContain("gpt-image-2");
    expect(report.chat.map((row) => row.id)).not.toContain("text-embedding-3-small");
    expect(report.counts).toMatchObject({ total: 5, chat: 3, chatKnown: 2, chatUnknown: 1 });
  });

  it("marks, for every preference list, which ids are live, missing, or unknown to the policy", () => {
    const report = buildCatalogReport({ generatedAt: GENERATED, models: all, lists: [list], source });
    const rows = report.lists[0]?.rows ?? [];
    expect(rows).toEqual([
      { wanted: "gpt-5.6-luna", status: "live", liveId: "gpt-5.6-luna", policyKey: "gpt-5.6", known: true },
      // The product matches a preferred id to the live one without regard to case; so does the report.
      { wanted: "Claude-Sonnet-5", status: "live", liveId: "claude-sonnet-5", policyKey: "claude-5", known: true },
      { wanted: "not-listed-anywhere", status: "missing" },
      { wanted: "brand-new-chat", status: "live", liveId: "brand-new-chat", policyKey: "UNKNOWN", known: false },
    ]);
    expect(report.lists[0]).toMatchObject({ name: "PREFS", live: 3, missing: 1, unknown: 1 });
  });

  it("matches a media list against the whole catalogue, and does not judge media ids by the chat policy", () => {
    const media = { name: "MEDIA.image", kind: "media" as const, ids: ["gpt-image-2", "seedream-5.0-pro"] };
    const report = buildCatalogReport({ generatedAt: GENERATED, models: all, lists: [media], source });
    expect(report.lists[0]?.rows).toEqual([
      { wanted: "gpt-image-2", status: "live", liveId: "gpt-image-2" },
      { wanted: "seedream-5.0-pro", status: "missing" },
    ]);
  });

  it("prints a price beside each model when it is given a lookup", () => {
    const priceOf = (id: string) => (id === "gpt-5.6-luna" ? "$1.00 in / $4.00 out per 1M" : undefined);
    const report = buildCatalogReport({ generatedAt: GENERATED, models: all, lists: [list], source, priceOf });
    expect(report.chat.find((row) => row.id === "gpt-5.6-luna")?.price).toBe("$1.00 in / $4.00 out per 1M");
    expect(report.chat.find((row) => row.id === "brand-new-chat")?.price).toBeUndefined();
    expect(report.lists[0]?.rows[0]).toMatchObject({ price: "$1.00 in / $4.00 out per 1M" });
  });

  it("keeps picker-hidden chat-kind ids in the table, flagged, so a rerank or OCR id is not mistaken for a chat model", () => {
    const report = buildCatalogReport({
      generatedAt: GENERATED,
      models: models("gpt-5.6-luna", "qwen3-rerank"),
      lists: [],
      source,
    });
    const rerank = report.chat.find((row) => row.id === "qwen3-rerank");
    if (rerank) {
      expect(rerank.hidden).toBe(true);
      expect(report.unknownChat).not.toContain("qwen3-rerank");
      expect(report.counts.chatHidden).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not mutate its input", () => {
    const input = { generatedAt: GENERATED, models: models("a", "b"), lists: [list], source };
    const copy = JSON.parse(JSON.stringify(input)) as typeof input;
    buildCatalogReport(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(copy);
  });
});

describe("snapshots and the diff against the last run", () => {
  it("snapshots every id and the chat ids, sorted and free of duplicates", () => {
    const report = buildCatalogReport({
      generatedAt: GENERATED,
      models: models("b-model", "gpt-5.6-luna", "gpt-image-2", "b-model"),
      lists: [],
      source,
    });
    expect(snapshotOf(report)).toEqual({
      version: 1,
      generatedAt: GENERATED.toISOString(),
      ids: ["b-model", "gpt-5.6-luna", "gpt-image-2"],
      chatIds: ["b-model", "gpt-5.6-luna"],
    });
  });

  const previous: CatalogSnapshot = {
    version: 1,
    generatedAt: "2026-09-29T09:00:00.000Z",
    ids: ["gpt-5.6-luna", "gone-model", "gpt-image-2"],
    chatIds: ["gpt-5.6-luna", "gone-model"],
  };

  it("lists new and removed ids, and flags a new chat id the policy does not know", () => {
    const report = buildCatalogReport({
      generatedAt: GENERATED,
      models: models("gpt-5.6-luna", "gpt-image-2", "shiny-new-model", "claude-sonnet-5", "veo_3_1-fast"),
      lists: [],
      source,
      previous,
    });
    expect(report.delta).toEqual({
      previousAt: "2026-09-29T09:00:00.000Z",
      added: [
        { id: "claude-sonnet-5", kind: "chat", policyKey: "claude-5", known: true },
        { id: "shiny-new-model", kind: "chat", policyKey: "UNKNOWN", known: false },
        { id: "veo_3_1-fast", kind: "video" },
      ],
      removed: [{ id: "gone-model", kind: "chat", policyKey: "UNKNOWN", known: false }],
    });
  });

  it("has no delta on the first run, and says the run is the baseline", () => {
    const report = buildCatalogReport({ generatedAt: GENERATED, models: models("a"), lists: [], source });
    expect(report.delta).toBeNull();
    expect(renderCatalogReport(report)).toMatch(/no previous snapshot/i);
  });

  it("reports an unchanged catalogue as unchanged", () => {
    const same = buildCatalogReport({ generatedAt: GENERATED, models: models("gpt-5.6-luna"), lists: [], source, previous: { ...previous, ids: ["gpt-5.6-luna"], chatIds: ["gpt-5.6-luna"] } });
    expect(same.delta).toEqual({ previousAt: previous.generatedAt, added: [], removed: [] });
    expect(renderCatalogReport(same)).toMatch(/no change/i);
  });

  it("diffSnapshots is symmetric in what it finds", () => {
    const next: CatalogSnapshot = { version: 1, generatedAt: "x", ids: ["a", "b"], chatIds: ["a"] };
    const before: CatalogSnapshot = { version: 1, generatedAt: "y", ids: ["b", "c"], chatIds: ["c"] };
    expect(diffSnapshots(before, next)).toEqual({ added: ["a"], removed: ["c"] });
    expect(diffSnapshots(next, before)).toEqual({ added: ["c"], removed: ["a"] });
  });
});

describe("renderCatalogReport", () => {
  const report = buildCatalogReport({
    generatedAt: GENERATED,
    models: models("gpt-5.6-luna", "brand-new-chat", "gpt-image-2"),
    lists: [{ name: "PREFS", kind: "chat", ids: ["gpt-5.6-luna", "ghost-model"] }],
    source: { dataDir: "/desk", refreshed: true, probedAt: "2026-09-30T09:00:00Z" },
    priceOf: (id) => (id === "gpt-5.6-luna" ? "$1.00 in / $4.00 out per 1M" : undefined),
  });
  const text = renderCatalogReport(report);

  it("puts UNKNOWN beside an id the policy does not know, and names the ones to probe", () => {
    expect(text).toMatch(/brand-new-chat\s+UNKNOWN/);
    expect(text).toMatch(/UNKNOWN to the policy table.*brand-new-chat/s);
  });

  it("prints the policy entry, wire and price for a known id", () => {
    expect(text).toMatch(/gpt-5\.6-luna\s+gpt-5\.6\s+responses/);
    expect(text).toContain("$1.00 in / $4.00 out per 1M");
  });

  it("prints each preference list with LIVE and MISSING", () => {
    expect(text).toContain("PREFS");
    expect(text).toMatch(/LIVE\s+gpt-5\.6-luna/);
    expect(text).toMatch(/MISSING\s+ghost-model/);
  });

  it("says where the list came from, and never prints a key", () => {
    expect(text).toContain("/desk");
    expect(text).toMatch(/refreshed from the gateway/i);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("says when there is no price list to show", () => {
    const none = renderCatalogReport(buildCatalogReport({ generatedAt: GENERATED, models: models("gpt-5.6-luna"), lists: [], source }));
    expect(none).toMatch(/prices: not shown/i);
  });
});
