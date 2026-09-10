import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, wrappingKeyFromSecret, type TenantContext } from "@agentforge/core";
import { UNVERIFIED_MARKER } from "@agentforge/core/finance";
import type { JobEvent, JobStepEvent } from "@agentforge/core/jobs";
import {
  ADVICE_MARKER,
  MARKET_DISCLAIMER,
  assertNoAdvice,
  buildWatchSystemPrompt,
  packetToPromptBlock,
  type MarketWatchPacket,
} from "@agentforge/core/market";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { createArtifactStore, type ArtifactStore } from "./artifacts";
import { FIXTURE_NOW, packet as packetFixture, tickerMu } from "./market/__fixtures__/watch";
import { SECTION_REWRITE_RULES } from "./market-briefing-build";
import {
  DRAFTING_HEARTBEAT_MS,
  MARKET_STREAM_WATCHDOG,
  MARKET_TOOL_BINDINGS,
  MARKET_WATCHDOG_IDLE_MS,
  MARKET_WATCHDOG_TTFB_MS,
  MARKET_WEB_TOOL_BINDINGS,
  USER_INSTRUCTION_HEADING,
  generateMarketBriefing,
  regenerateBriefingSection,
  withClientAbort,
  type AskOptions,
  type MarketGenerateDeps,
} from "./market-generate";

const KEY = wrappingKeyFromSecret("b".repeat(64));
const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };
const now = () => FIXTURE_NOW;

const DRAFT = {
  title: "Memory names lead the open",
  sections: [
    { heading: "TL;DR + confidence", body: "MU at 1000.26, pre-market 1004.1 (-1.22%). Confidence medium." },
    { heading: "Macro now", body: "ES 6612.25, VIX 15.12. The 10Y sits at 4.21%." },
    { heading: "Signals at the open", body: "Above SMA50 902.4. Beli sekarang sebelum open." },
  ],
};

const REQUEST = {
  prompt: "Pre-market briefing please",
  tickers: ["mu", "BBCA"],
  language: "en" as const,
  maxChars: 5000,
};

describe("generateMarketBriefing", () => {
  let db: Database.Database;
  let artifacts: ArtifactStore;
  let asked: AskOptions[];
  let events: JobEvent[];
  let built: Array<{ request: unknown; signal: AbortSignal | undefined }>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    artifacts = createArtifactStore(db, () => KEY);
    asked = [];
    events = [];
    built = [];
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  function deps(
    overrides: Partial<MarketGenerateDeps> & { packet?: MarketWatchPacket; failures?: string[] } = {},
  ): MarketGenerateDeps {
    const { packet, failures, ...rest } = overrides;
    return {
      db: () => db,
      now,
      artifacts: () => artifacts,
      webReady: () => false,
      buildPacket: async (_db, request, opts) => {
        built.push({ request, signal: opts?.signal });
        for (const phase of ["resolving", "quotes", "technicals", "charts", "news", "macro"] as const) {
          opts?.onProgress?.(phase, phase === "resolving" ? "Resolving tickers" : `${phase} done`);
        }
        return { packet: packet ?? packetFixture(), failures: failures ?? [] };
      },
      ask: async (options) => {
        asked.push(options);
        return JSON.stringify(DRAFT);
      },
      ...rest,
    };
  }

  const emit = (event: JobEvent) => {
    events.push(event);
  };

  it("refuses with 503 runtime_stub before validating the body", async () => {
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
    const error = await generateMarketBriefing(tenant, { nope: true }, emit, undefined, deps()).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "runtime_stub", status: 503 });
    expect(built).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("rejects a malformed request with 400 naming the field", async () => {
    const error = await generateMarketBriefing(tenant, { prompt: "x" }, emit, undefined, deps()).catch((e) => e);
    expect(error).toMatchObject({ code: "invalid_request", status: 400 });
    expect(String(error.message)).toContain("tickers");
    const tooMany = await generateMarketBriefing(
      tenant,
      { prompt: "x", tickers: new Array(16).fill("MU") },
      emit,
      undefined,
      deps(),
    ).catch((e) => e);
    expect(tooMany).toMatchObject({ code: "invalid_request", status: 400 });
    const notObject = await generateMarketBriefing(tenant, "text", emit, undefined, deps()).catch((e) => e);
    expect(notObject).toMatchObject({ code: "invalid_request", status: 400 });
  });

  it("runs every phase, prompts with the packet block and the user's instruction, guards, and saves a briefing artifact", async () => {
    const result = await generateMarketBriefing(
      tenant,
      { ...REQUEST, positionContext: "MU target 1100" },
      emit,
      undefined,
      deps(),
    );

    expect(
      events.filter((event) => event.type === "job.phase").map((event) => (event as { phase: string }).phase),
    ).toEqual(["resolving", "quotes", "technicals", "charts", "news", "macro", "drafting", "verifying", "saving"]);
    expect(events).toContainEqual({ type: "job.phase", phase: "resolving", label: "Resolving tickers" });
    expect(events).toContainEqual({ type: "job.phase", phase: "drafting", label: "Drafting the briefing" });
    expect(events).toContainEqual({
      type: "job.phase",
      phase: "verifying",
      label: "Checking every figure and sentence",
    });
    expect(events).toContainEqual({ type: "job.step", phase: "quotes", label: "quotes done" });

    expect(built[0]?.request).toMatchObject({
      tickers: ["mu", "BBCA"],
      language: "en",
      maxChars: 5000,
      positionContext: "MU target 1100",
    });
    expect(asked).toHaveLength(1);
    const ask = asked[0] as AskOptions;
    const packet = result.briefing.packet;
    expect(ask.systemPrompt).toBe(
      buildWatchSystemPrompt({ language: "en", maxChars: 5000, clockNote: packet.clock.note }),
    );
    expect(ask.prompt).toBe(
      `${packetToPromptBlock(packet)}\n\n${USER_INSTRUCTION_HEADING}\nPre-market briefing please`,
    );
    expect(ask.toolKeys).toEqual([...MARKET_TOOL_BINDINGS]);
    expect(ask.toolKeys).toEqual(["market_news", "market_quotes", "market_history", "calculator"]);
    expect(ask.agentId).toBe("market");
    expect(ask.streamWatchdog).toEqual({ ttfbMs: MARKET_WATCHDOG_TTFB_MS, idleMs: MARKET_WATCHDOG_IDLE_MS });
    expect(ask.streamWatchdog).toEqual(MARKET_STREAM_WATCHDOG);
    expect(MARKET_STREAM_WATCHDOG).toEqual({ ttfbMs: 180_000, idleMs: 150_000 });

    expect(result.briefing.title).toBe("Memory names lead the open");
    expect(result.briefing.language).toBe("en");
    expect(result.briefing.sections[1]?.body).toBe(`ES 6612.25, VIX 15.12. The 10Y sits at ${UNVERIFIED_MARKER}.`);
    expect(result.briefing.sections[2]?.body).toBe(`Above SMA50 902.4. ${ADVICE_MARKER}`);
    expect(result.briefing.disclaimer).toBe(MARKET_DISCLAIMER);
    expect(result.briefing.guardedSections).toBe(1);
    expect(result.briefing.packet.positionContext).toBe("");
    expect(result.guard).toEqual({ flagged: [{ section: 1, text: "4.21%" }], total: 1, adviceReplaced: 1 });
    expect(result.failures).toEqual([]);
    expect(() => assertNoAdvice(result.briefing.sections)).not.toThrow();
    expect(result.markdown).toContain("# Memory names lead the open");
    expect(result.markdown).toContain("## Watchlist data");

    expect(result.artifactId).not.toBeNull();
    const saved = artifacts.get(tenant, result.artifactId as string);
    expect(saved).toMatchObject({
      mode: "market",
      kind: "briefing",
      title: "Memory names lead the open",
      mime: "text/markdown",
    });
    expect(saved?.meta).toMatchObject({
      tickers: ["MU", "BBCA.JK"],
      language: "en",
      flagged: 1,
      adviceReplaced: 1,
      usSession: "pre",
    });
    expect(saved?.body).toBe(result.markdown);
    expect(events).toContainEqual({
      type: "job.step",
      phase: "verifying",
      label: "1 unverified figure(s) removed; 1 directive sentence(s) removed",
    });
  });

  it("binds web_search and web_fetch only when a search backend is ready", async () => {
    await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps({ webReady: () => true }));
    expect(asked[0]?.toolKeys).toEqual([...MARKET_TOOL_BINDINGS, ...MARKET_WEB_TOOL_BINDINGS]);
  });

  it("reports source failures as a step and keeps going", async () => {
    const result = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({
        packet: packetFixture({ tickers: [tickerMu({ failures: ["tradingview: america: HTTP 429"] })] }),
        failures: ["ZZZZ: unknown symbol"],
      }),
    );
    expect(result.failures).toEqual(["ZZZZ: unknown symbol"]);
    expect(events).toContainEqual({
      type: "job.step",
      phase: "macro",
      label: "Some sources were unavailable",
      detail: "ZZZZ: unknown symbol; MU: tradingview: america: HTTP 429",
    });
    const saved = artifacts.get(tenant, result.artifactId as string);
    expect(saved?.meta.failures).toEqual(["ZZZZ: unknown symbol", "MU: tradingview: america: HTTP 429"]);
  });

  it("fails with 400 when no ticker resolved and with 502 when the market data was unreachable", async () => {
    const empty = packetFixture({ tickers: [] });
    const unknown = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({ packet: empty, failures: ["mu: unknown symbol (no quote)"] }),
    ).catch((e) => e);
    expect(unknown).toMatchObject({ code: "invalid_ticker", status: 400 });
    const down = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({ packet: empty, failures: ["mu: ECONNRESET"] }),
    ).catch((e) => e);
    expect(down).toMatchObject({ code: "market_unavailable", status: 502 });
    expect(asked).toEqual([]);
  });

  it("fails closed on an empty or non-JSON draft", async () => {
    const empty = await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps({ ask: async () => "  " })).catch(
      (e) => e,
    );
    expect(empty).toMatchObject({ code: "generation_failed", status: 502 });
    const garbage = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({ ask: async () => "no json here" }),
    ).catch((e) => e);
    expect(garbage).toMatchObject({ code: "invalid_market", status: 502 });
  });

  it("emits a heartbeat step every 20s while drafting and stops it once the model returns", async () => {
    vi.useFakeTimers();
    try {
      let finish: (raw: string) => void = () => {};
      let started: () => void = () => {};
      const askStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = generateMarketBriefing(
        tenant,
        REQUEST,
        emit,
        undefined,
        deps({
          ask: () =>
            new Promise<string>((resolve) => {
              finish = resolve;
              started();
            }),
        }),
      );
      await askStarted;
      const heartbeats = () =>
        events.filter(
          (event): event is JobStepEvent =>
            event.type === "job.step" && event.phase === "drafting" && /Still drafting/.test(event.label),
        );

      expect(DRAFTING_HEARTBEAT_MS).toBe(20_000);
      vi.advanceTimersByTime(DRAFTING_HEARTBEAT_MS - 1);
      expect(heartbeats()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(heartbeats()).toEqual([{ type: "job.step", phase: "drafting", label: "Still drafting… 20s" }]);
      vi.advanceTimersByTime(DRAFTING_HEARTBEAT_MS);
      expect(heartbeats().map((event) => event.label)).toEqual(["Still drafting… 20s", "Still drafting… 40s"]);

      finish(JSON.stringify(DRAFT));
      const result = await pending;
      expect(result.briefing.title).toBe("Memory names lead the open");
      vi.advanceTimersByTime(DRAFTING_HEARTBEAT_MS * 3);
      expect(heartbeats()).toHaveLength(2);
      expect(
        events.filter((event) => event.type === "job.phase").map((event) => (event as { phase: string }).phase),
      ).toEqual(["resolving", "quotes", "technicals", "charts", "news", "macro", "drafting", "verifying", "saving"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the drafting heartbeat when the model call fails", async () => {
    vi.useFakeTimers();
    try {
      const failed = await generateMarketBriefing(
        tenant,
        REQUEST,
        emit,
        undefined,
        deps({ ask: async () => "  " }),
      ).catch((e) => e);
      expect(failed).toMatchObject({ code: "generation_failed", status: 502 });
      vi.advanceTimersByTime(DRAFTING_HEARTBEAT_MS * 2);
      expect(events.filter((event) => event.type === "job.step" && /Still drafting/.test(event.label))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops before the packet when already aborted and drops the model call when the client leaves mid-draft", async () => {
    const early = new AbortController();
    early.abort();
    const before = await generateMarketBriefing(tenant, REQUEST, emit, early.signal, deps()).catch((e) => e);
    expect(before).toMatchObject({ code: "aborted", status: 499 });
    expect(built).toEqual([]);

    const late = new AbortController();
    const never = new Promise<string>(() => {});
    const pending = generateMarketBriefing(tenant, REQUEST, emit, late.signal, deps({ ask: () => never }));
    await vi.waitFor(() => expect(built).toHaveLength(1));
    late.abort();
    const during = await pending.catch((e) => e);
    expect(during).toMatchObject({ code: "aborted", status: 499 });
    expect(built[0]?.signal).toBe(late.signal);
  });
});

describe("withClientAbort", () => {
  it("passes through without a signal, resolves normally, and rejects 499 on abort", async () => {
    expect(await withClientAbort(Promise.resolve(1), undefined)).toBe(1);
    const controller = new AbortController();
    expect(await withClientAbort(Promise.resolve(2), controller.signal)).toBe(2);
    const pending = withClientAbort(new Promise<number>(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted", status: 499 });
  });
});

describe("regenerateBriefingSection", () => {
  let db: Database.Database;
  let asked: AskOptions[];

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    asked = [];
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  async function briefing() {
    const result = await generateMarketBriefing(tenant, REQUEST, undefined, undefined, {
      db: () => db,
      now,
      artifacts: () => createArtifactStore(db, () => KEY),
      webReady: () => false,
      buildPacket: async () => ({ packet: packetFixture(), failures: [] }),
      ask: async () => JSON.stringify(DRAFT),
    });
    return result.briefing;
  }

  function deps(reply: string): MarketGenerateDeps {
    return {
      db: () => db,
      now,
      webReady: () => false,
      ask: async (options) => {
        asked.push(options);
        return reply;
      },
    };
  }

  it("rewrites one section over the same packet with both guards", async () => {
    const current = await briefing();
    const result = await regenerateBriefingSection(
      tenant,
      { briefing: current, section: 1, instruction: "Shorter" },
      deps(JSON.stringify({ heading: "Macro now", body: "ES 6612.25. VIX 15.12. Oil 63.4. Jual sekarang." })),
    );
    expect(result.section).toEqual({
      heading: "Macro now",
      body: `ES 6612.25. VIX 15.12. Oil ${UNVERIFIED_MARKER}. ${ADVICE_MARKER}`,
    });
    expect(result.guard).toEqual({ flagged: [{ section: 1, text: "63.4" }], total: 1, adviceReplaced: 1 });
    const ask = asked[0] as AskOptions;
    expect(ask.systemPrompt.endsWith(SECTION_REWRITE_RULES)).toBe(true);
    expect(ask.prompt).toContain(packetToPromptBlock(current.packet));
    expect(ask.prompt).toContain("Rewrite this section only.\nHeading: Macro now");
    expect(ask.prompt).toContain("- TL;DR + confidence");
    expect(ask.prompt).not.toContain("- Macro now");
    expect(ask.prompt).toContain("Shorter");
    expect(ask.toolKeys).toEqual([...MARKET_TOOL_BINDINGS]);
    expect(ask.streamWatchdog).toEqual({ ttfbMs: MARKET_WATCHDOG_TTFB_MS, idleMs: MARKET_WATCHDOG_IDLE_MS });
  });

  it("rejects a malformed briefing, an out-of-range section, and a client briefing that carries advice", async () => {
    const current = await briefing();
    await expect(
      regenerateBriefingSection(tenant, { briefing: { nope: true }, section: 0 }, deps("{}")),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(
      regenerateBriefingSection(tenant, { briefing: current, section: 9 }, deps("{}")),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    const leaked = { ...current, sections: [{ heading: "TL;DR", body: "Buy now." }] };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        regenerateBriefingSection(tenant, { briefing: leaked, section: 0 }, deps("{}")),
      ).rejects.toMatchObject({ code: "advice_leak", status: 502 });
    } finally {
      error.mockRestore();
    }
    expect(asked).toEqual([]);
  });

  it("validates the body before the runtime: 400 for a malformed briefing, 503 for a sound one on stub", async () => {
    const current = await briefing();
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
    await expect(regenerateBriefingSection(tenant, { briefing: {}, section: 0 }, deps("{}"))).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    await expect(
      regenerateBriefingSection(tenant, { briefing: current, section: 0 }, deps("{}")),
    ).rejects.toMatchObject({
      code: "runtime_stub",
      status: 503,
    });
    expect(asked).toEqual([]);
  });
});
