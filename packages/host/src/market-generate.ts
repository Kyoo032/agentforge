/**
 * Market Watch job: resolving -> quotes -> technicals -> charts -> news ->
 * macro -> drafting -> verifying -> saving.
 *
 * The host builds the packet (any tickers, several at once, through the
 * cache), the model writes the briefing over the packet plus the user's
 * instruction, both guards run on every section, and the briefing is saved
 * as a `market` / `briefing` artifact. Dependencies are injectable so tests
 * run without a gateway, a network, or the app database.
 */
import type Database from "better-sqlite3";
import {
  ApiError,
  gatewayRequiredMessage,
  hasLiveProvider,
  modeMessage,
  resolveChatModel,
  resolveRuntimeMode,
  resolveToolBackend,
  type TenantContext,
} from "@agentforge/core";
import {
  marketBriefingSchema,
  marketBriefingToMarkdown,
  type BriefingSection,
  type MarketBriefing,
} from "@agentforge/core/artifacts";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  buildWatchSystemPrompt,
  marketWatchRequestSchema,
  packetToPromptBlock,
  type MarketWatchPacket,
  type MarketWatchRequest,
} from "@agentforge/core/market";
import { artifactStore, type ArtifactStore } from "./artifacts";
import { appendRegenInstruction, collectJobAssistantText, readOptionalInstruction } from "./job-regen";
import { throwIfJobAborted } from "./job-stream";
import {
  allowedNumbers,
  assertBriefingHasNoAdvice,
  buildMarketBriefing,
  guardBriefingSection,
  parseBriefingDraft,
  parseBriefingSection,
  sectionSystemPrompt,
  type MarketGuardReport,
} from "./market-briefing-build";
import { buildMarketWatchPacket, type PacketClients, type PacketPhase } from "./market/packet";
import { ensureToolsRegistered } from "./register-tools";
import { localeForRun } from "./run-context";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";

/** Tools the drafting model may call: more headlines and quotes, arithmetic; web research when a search key is saved. */
export const MARKET_TOOL_BINDINGS: readonly string[] = ["market_news", "market_quotes", "market_history", "calculator"];
export const MARKET_WEB_TOOL_BINDINGS: readonly string[] = ["web_search", "web_fetch"];
/** Character budget handed to the model for a single-section rewrite. */
export const SECTION_MAX_CHARS = 3000;
export const USER_INSTRUCTION_HEADING = "USER INSTRUCTION:";
/**
 * Stream watchdog for the drafting call. A 10-15 ticker packet with eight
 * headlines each plus bound tools makes deepseek-class models sit silent for
 * over a minute before the first token (and again between tool rounds); the same
 * request completes in ~90 s over the non-stream API. Those families now carry the
 * reasoning floors themselves (240 s / 180 s in `stream-watchdog.ts`), so this is
 * inert for them and still covers an everyday model picked by hand. These only
 * ever raise the model defaults.
 */
export const MARKET_WATCHDOG_TTFB_MS = 180_000;
export const MARKET_WATCHDOG_IDLE_MS = 150_000;
export const MARKET_STREAM_WATCHDOG: Readonly<{ ttfbMs: number; idleMs: number }> = {
  ttfbMs: MARKET_WATCHDOG_TTFB_MS,
  idleMs: MARKET_WATCHDOG_IDLE_MS,
};
/** A "Still drafting" step this often so the studio progress list does not look frozen mid-draft. */
export const DRAFTING_HEARTBEAT_MS = 20_000;

const PHASE_LABELS: Readonly<Record<PacketPhase, string>> = {
  resolving: "Resolving tickers",
  quotes: "Reading quotes",
  technicals: "Reading technicals and TradingView ratings",
  charts: "Building charts",
  news: "Reading headlines",
  macro: "Reading macro levels",
};

export type MarketWatchResult = {
  briefing: MarketBriefing;
  artifactId: string | null;
  markdown: string;
  guard: MarketGuardReport;
  /** Packet-wide failures (unresolved tickers, macro); per-ticker ones are on each TickerPacket. */
  failures: string[];
};

export type MarketRegenerateResult = {
  section: BriefingSection;
  guard: MarketGuardReport;
};

export type AskOptions = Parameters<typeof collectJobAssistantText>[0];
export type AskFn = (options: AskOptions) => Promise<string>;

export type MarketGenerateDeps = {
  db?: () => Database.Database | Promise<Database.Database>;
  now?: () => Date;
  ask?: AskFn;
  artifacts?: () => ArtifactStore;
  clients?: PacketClients;
  buildPacket?: typeof buildMarketWatchPacket;
  /** Whether web_search / web_fetch have a backend key; defaults to core's tool routing. */
  webReady?: () => boolean;
};

type Resolved = Required<MarketGenerateDeps>;

const NO_EMIT: JobEmitter = () => {};

const defaultAsk: AskFn = (options) => {
  ensureToolsRegistered();
  return collectJobAssistantText(options);
};

function resolveDeps(deps: MarketGenerateDeps): Resolved {
  const now = deps.now ?? (() => new Date());
  return {
    db: deps.db ?? (async () => (await import("@agentforge/db")).sql),
    now,
    ask: deps.ask ?? defaultAsk,
    artifacts: deps.artifacts ?? artifactStore,
    clients: deps.clients ?? {},
    buildPacket: deps.buildPacket ?? buildMarketWatchPacket,
    webReady: deps.webReady ?? (() => resolveToolBackend("web").ready),
  };
}

function requireLive(workspaceId: string): ReturnType<typeof loadSettings> {
  const settings = loadSettings(workspaceId);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("market", localeForRun()), 503);
  }
  return settings;
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}

export function parseWatchRequest(body: unknown): MarketWatchRequest {
  const parsed = marketWatchRequestSchema.safeParse(requireObject(body));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new ApiError("invalid_request", `Invalid market request: ${detail}`, 400);
  }
  return parsed.data;
}

function resolveModel(requested: string | undefined, settings: ReturnType<typeof loadSettings>): string {
  const wanted = requested?.trim() ? requested.trim() : undefined;
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(wanted, settings.documentGenModel || defaults.market, listSelectableModels());
}

/** Reject with 499 the moment the client leaves; the gateway call itself cannot be cancelled from here. */
export function withClientAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return work;
  }
  throwIfJobAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApiError("aborted", "Job cancelled", 499));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function toolKeysFor(webReady: boolean): string[] {
  return [...MARKET_TOOL_BINDINGS, ...(webReady ? MARKET_WEB_TOOL_BINDINGS : [])];
}

export function briefingPrompt(packet: MarketWatchPacket, instruction: string): string {
  return `${packetToPromptBlock(packet)}\n\n${USER_INSTRUCTION_HEADING}\n${instruction.trim()}`;
}

/** 400 when every input was an unknown symbol, 502 when a source was down for all of them. */
export function requireTickers(packet: MarketWatchPacket, failures: readonly string[]): void {
  if (packet.tickers.length > 0) {
    return;
  }
  const detail = failures.join("; ") || "no ticker resolved";
  const unknownOnly = failures.length > 0 && failures.every((entry) => /unknown symbol|not a ticker/.test(entry));
  throw unknownOnly
    ? new ApiError("invalid_ticker", `No ticker resolved: ${detail}`, 400)
    : new ApiError("market_unavailable", `Market data could not be fetched: ${detail}`, 502);
}

function guardLabel(guard: MarketGuardReport): string {
  return [
    guard.total === 0 ? "All figures trace to the packet" : `${guard.total} unverified figure(s) removed`,
    guard.adviceReplaced === 0 ? "no directive language" : `${guard.adviceReplaced} directive sentence(s) removed`,
  ].join("; ");
}

function persistBriefing(
  store: ArtifactStore,
  tenant: TenantContext,
  briefing: MarketBriefing,
  markdown: string,
  meta: Record<string, unknown>,
): string | null {
  try {
    return store.create(tenant, {
      mode: "market",
      kind: "briefing",
      title: briefing.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    console.warn(`market: could not save briefing (${code})`);
    return null;
  }
}

/** Everything one Market Watch run carries between its steps. */
type WatchRun = {
  tenant: TenantContext;
  request: MarketWatchRequest;
  model: string;
  resolved: Resolved;
  emit: JobEmitter;
  abortSignal: AbortSignal | undefined;
};

type LoadedPacket = {
  packet: MarketWatchPacket;
  /** Packet-wide failures (unresolved tickers, macro). */
  failures: string[];
  /** Per-ticker failures, prefixed with the Yahoo symbol. */
  tickerFailures: string[];
};

type VerifiedBriefing = { briefing: MarketBriefing; guard: MarketGuardReport };

/**
 * Emit "Still drafting… <n>s" every `DRAFTING_HEARTBEAT_MS` until the returned
 * stop function runs. Tick-counted rather than clock-read so the label is
 * deterministic under fake timers and an injected `now`.
 */
export function startDraftingHeartbeat(emit: JobEmitter, intervalMs: number = DRAFTING_HEARTBEAT_MS): () => void {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const seconds = Math.round((ticks * intervalMs) / 1000);
    emit({ type: "job.step", phase: "drafting", label: `Still drafting… ${seconds}s` });
  }, intervalMs);
  return () => clearInterval(timer);
}

/** resolving -> quotes -> technicals -> charts -> news -> macro, then the "no ticker" gate and a failures step. */
async function loadPacket(run: WatchRun): Promise<LoadedPacket> {
  const { resolved, request, emit, abortSignal } = run;
  const db = await resolved.db();
  const { packet, failures } = await resolved.buildPacket(db, request, {
    now: resolved.now,
    clients: resolved.clients,
    signal: abortSignal,
    onProgress: (phase, label) => {
      emit({ type: "job.phase", phase, label: PHASE_LABELS[phase] });
      if (label !== PHASE_LABELS[phase]) {
        emit({ type: "job.step", phase, label });
      }
    },
  });
  requireTickers(packet, failures);
  const tickerFailures = packet.tickers.flatMap((ticker) =>
    ticker.failures.map((entry) => `${ticker.symbol.yahoo}: ${entry}`),
  );
  if (failures.length > 0 || tickerFailures.length > 0) {
    emit({
      type: "job.step",
      phase: "macro",
      label: "Some sources were unavailable",
      detail: [...failures, ...tickerFailures].join("; "),
    });
  }
  return { packet, failures, tickerFailures };
}

/** The model writes the briefing over the packet; a heartbeat step keeps the progress list alive meanwhile. */
async function draftBriefing(run: WatchRun, packet: MarketWatchPacket): Promise<string> {
  const { tenant, request, model, resolved, emit, abortSignal } = run;
  emit({ type: "job.phase", phase: "drafting", label: "Drafting the briefing" });
  const stopHeartbeat = startDraftingHeartbeat(emit);
  let raw: string;
  try {
    raw = await withClientAbort(
      resolved.ask({
        tenant,
        model,
        systemPrompt: buildWatchSystemPrompt({
          language: request.language,
          maxChars: request.maxChars,
          clockNote: packet.clock.note,
        }),
        runPrefix: "market",
        agentId: "market",
        jobMode: "market",
        versionId: "market-briefing",
        prompt: briefingPrompt(packet, request.prompt),
        toolKeys: toolKeysFor(resolved.webReady()),
        streamWatchdog: MARKET_STREAM_WATCHDOG,
      }),
      abortSignal,
    );
  } finally {
    stopHeartbeat();
  }
  if (!raw.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyMarketBriefing", localeForRun()), 502);
  }
  return raw;
}

/** Parse the draft and run both guards (numbers, advice) on every section. */
function verifyBriefing(run: WatchRun, raw: string, packet: MarketWatchPacket): VerifiedBriefing {
  const { request, resolved, emit } = run;
  emit({ type: "job.phase", phase: "verifying", label: "Checking every figure and sentence" });
  const verified = buildMarketBriefing(parseBriefingDraft(raw), packet, {
    language: request.language,
    generatedAt: resolved.now().toISOString(),
  });
  emit({ type: "job.step", phase: "verifying", label: guardLabel(verified.guard) });
  return verified;
}

/** Final advice gate, markdown, and the `market` / `briefing` artifact. */
function saveBriefing(run: WatchRun, verified: VerifiedBriefing, loaded: LoadedPacket): MarketWatchResult {
  const { tenant, request, model, resolved, emit } = run;
  const { briefing, guard } = verified;
  const { packet, failures, tickerFailures } = loaded;
  emit({ type: "job.phase", phase: "saving", label: "Saving briefing" });
  assertBriefingHasNoAdvice(briefing.sections);
  const markdown = marketBriefingToMarkdown(briefing);
  const artifactId = persistBriefing(resolved.artifacts(), tenant, briefing, markdown, {
    tickers: packet.tickers.map((ticker) => ticker.symbol.yahoo),
    question: request.prompt,
    model,
    language: request.language,
    generatedAt: briefing.generatedAt,
    usSession: packet.clock.usSession,
    flagged: guard.total,
    adviceReplaced: guard.adviceReplaced,
    guardedSections: briefing.guardedSections,
    sourceCount: briefing.sources.length,
    failures: [...failures, ...tickerFailures],
  });
  return { briefing, artifactId, markdown, guard, failures };
}

export async function generateMarketBriefing(
  tenant: TenantContext,
  body: unknown,
  emit: JobEmitter = NO_EMIT,
  abortSignal?: AbortSignal,
  deps: MarketGenerateDeps = {},
): Promise<MarketWatchResult> {
  // A malformed client payload is a 400 whatever the runtime; the gateway check comes once the body is sound.
  const request = parseWatchRequest(body);
  const settings = requireLive(tenant.workspaceId);
  const run: WatchRun = {
    tenant,
    request,
    model: resolveModel(request.model, settings),
    resolved: resolveDeps(deps),
    emit,
    abortSignal,
  };

  throwIfJobAborted(abortSignal);
  const loaded = await loadPacket(run);
  throwIfJobAborted(abortSignal);
  const raw = await draftBriefing(run, loaded.packet);
  throwIfJobAborted(abortSignal);
  const verified = verifyBriefing(run, raw, loaded.packet);
  throwIfJobAborted(abortSignal);
  return saveBriefing(run, verified, loaded);
}

function readSectionIndex(body: Record<string, unknown>, length: number): number {
  const index = body.section;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
    throw new ApiError("invalid_request", "section is out of range", 400);
  }
  return index;
}

function sectionPrompt(briefing: MarketBriefing, index: number, current: BriefingSection): string {
  const others = briefing.sections
    .map((section, at) => (at === index ? null : `- ${section.heading}`))
    .filter(Boolean)
    .join("\n");
  return [
    packetToPromptBlock(briefing.packet),
    `Briefing title: ${briefing.title}`,
    `Other sections:\n${others || "- none"}`,
    `Rewrite this section only.\nHeading: ${current.heading}\nBody:\n${current.body}`,
  ].join("\n\n");
}

/** Rewrite one section over the same packet; both guards run again on the result. */
export async function regenerateBriefingSection(
  tenant: TenantContext,
  body: unknown,
  deps: MarketGenerateDeps = {},
): Promise<MarketRegenerateResult> {
  // A malformed client payload is a 400 whatever the runtime; the gateway check comes once the body is sound.
  const record = requireObject(body);
  const parsed = marketBriefingSchema.safeParse(record.briefing);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "briefing is missing or malformed", 400);
  }
  const briefing = parsed.data;
  // The briefing comes from the client: it must pass the advice guard again before it reaches a prompt.
  assertBriefingHasNoAdvice(briefing.sections);
  const index = readSectionIndex(record, briefing.sections.length);
  const current = briefing.sections[index] as BriefingSection;
  const settings = requireLive(tenant.workspaceId);
  const model = resolveModel(typeof record.model === "string" ? record.model : undefined, settings);
  const resolved = resolveDeps(deps);

  const raw = await resolved.ask({
    tenant,
    model,
    systemPrompt: sectionSystemPrompt({
      language: briefing.language,
      maxChars: SECTION_MAX_CHARS,
      clockNote: briefing.packet.clock.note,
    }),
    runPrefix: "market-section",
    agentId: "market",
    jobMode: "market",
    versionId: "market-section",
    prompt: appendRegenInstruction(sectionPrompt(briefing, index, current), readOptionalInstruction(record)),
    toolKeys: toolKeysFor(resolved.webReady()),
    streamWatchdog: MARKET_STREAM_WATCHDOG,
  });
  const rewritten = guardBriefingSection(parseBriefingSection(raw), allowedNumbers(briefing.packet));
  assertBriefingHasNoAdvice([rewritten.section]);
  return {
    section: rewritten.section,
    guard: {
      flagged: rewritten.flagged.map((text) => ({ section: index, text })),
      total: rewritten.flagged.length,
      adviceReplaced: rewritten.adviceReplaced,
    },
  };
}
