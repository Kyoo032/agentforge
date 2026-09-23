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
import { marketBriefingSchema, type BriefingSection, type MarketBriefing } from "@agentforge/core/artifacts";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  DEFAULT_MARKET_SPECIALIST,
  TEAM_MAX_CALLS,
  analystsFor,
  buildWatchSystemPrompt,
  harnessFor,
  marketWatchRequestSchema,
  packetToPromptBlock,
  teamAvailable,
  type MarketSpecialist,
  type MarketToolKey as HarnessToolKey,
  type MarketWatchPacket,
  type MarketWatchRequest,
  type TeamNotes,
} from "@agentforge/core/market";
import { artifactStore, type ArtifactStore } from "./artifacts";
import { artifactWorkCard } from "./work-cards";
import {
  appendRegenInstruction,
  collectJobAssistantRun,
  readModelPinned,
  readOptionalInstruction,
  type JobAssistantRun,
} from "./job-regen";
import { throwIfJobAborted } from "./job-stream";
import {
  allowedNumbers,
  assertBriefingHasNoAdvice,
  buildMarketBriefing,
  guardBriefingSection,
  marketBriefingMarkdown,
  parseBriefingDraft,
  parseBriefingSection,
  sectionSystemPrompt,
  teamSectionSystemPrompt,
  type MarketGuardReport,
} from "./market-briefing-build";
import { upsertWorkSource } from "./knowledge-ingest";
import { buildMarketWatchPacket, type PacketClients, type PacketPhase } from "./market/packet";
import { guardTeamNotes, runTeamPipeline, type TeamAsk } from "./market-team";
import { ensureToolsRegistered } from "./register-tools";
import { localeForRun } from "./run-context";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { log } from "./log";

/**
 * Core names a desk's tools in its own terms (`quotes`, `technical`, …); this
 * table is the only place those become the host's registered binding names.
 * Which of them a desk actually gets is `harnessFor(specialist).tools`.
 */
export const MARKET_TOOL_BINDINGS: Readonly<Record<HarnessToolKey, string>> = {
  quotes: "market_quotes",
  history: "market_history",
  technical: "market_technical",
  macro: "market_macro",
  news: "market_news",
  calculator: "calculator",
};
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

export type AskOptions = Parameters<typeof collectJobAssistantRun>[0];
/**
 * One model call. The default answers with the run: the text and the model that wrote it, which is
 * the stand-in after a fallback. A bare string (a test fake) reads as the requested model answering.
 */
export type AskFn = (options: AskOptions) => Promise<string | JobAssistantRun>;

type Answer = Pick<JobAssistantRun, "text" | "model">;

function answerOf(reply: string | JobAssistantRun, asked: string): Answer {
  return typeof reply === "string" ? { text: reply, model: asked } : { text: reply.text, model: reply.model };
}

export type MarketGenerateDeps = {
  db?: () => Database.Database | Promise<Database.Database>;
  now?: () => Date;
  ask?: AskFn;
  artifacts?: () => ArtifactStore;
  clients?: PacketClients;
  buildPacket?: typeof buildMarketWatchPacket;
  /** Whether web_search / web_fetch have a backend key; defaults to core's tool routing. */
  webReady?: () => boolean;
  /** Writes the briefing's work card into the Knowledge Base. Injected so tests never index. */
  ingest?: typeof upsertWorkSource;
};

type Resolved = Required<MarketGenerateDeps>;

const NO_EMIT: JobEmitter = () => {};

const defaultAsk: AskFn = (options) => {
  ensureToolsRegistered();
  return collectJobAssistantRun(options);
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
    ingest: deps.ingest ?? upsertWorkSource,
  };
}

function requireLive(tenant: TenantContext): ReturnType<typeof loadSettings> {
  const settings = loadSettings(tenant);
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

/**
 * Start `work` only while the client is still there, and reject with 499 the moment it leaves.
 *
 * `work` is a thunk so a run whose client already left never starts the paid call. The model calls
 * hand the same signal to the runtime (`signal` on the ask), which aborts the request in flight;
 * this race is what answers 499 at once whatever `work` does with it, and `Promise.race` observes
 * `work`, which drops a late answer and keeps a late failure from rejecting unhandled.
 */
export async function withClientAbort<T>(work: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfJobAborted(signal);
  if (!signal) {
    return work();
  }
  let onAbort = () => {};
  const left = new Promise<never>((_, reject) => {
    onAbort = () => reject(new ApiError("aborted", "Job cancelled", 499));
  });
  // Observed here as well as by the race, in case `work()` throws before the race is reached.
  left.catch(() => {});
  // Listening before the call starts, so a client that leaves while it is being set up still wins.
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([work(), left]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * The tools this desk may call. Web research is bound only when the desk asks
 * for it AND a search backend key is saved — a scanner never gets a browser.
 */
export function toolKeysFor(specialist: MarketSpecialist, webReady: boolean): string[] {
  const harness = harnessFor(specialist);
  return [
    ...harness.tools.map((key) => MARKET_TOOL_BINDINGS[key]),
    ...(harness.webResearch && webReady ? MARKET_WEB_TOOL_BINDINGS : []),
  ];
}

export function briefingPrompt(
  packet: MarketWatchPacket,
  instruction: string,
  specialist: MarketSpecialist = DEFAULT_MARKET_SPECIALIST,
): string {
  return `${packetToPromptBlock(packet, specialist)}\n\n${USER_INSTRUCTION_HEADING}\n${instruction.trim()}`;
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
    log.warn("market_briefing_not_saved", { code });
    return null;
  }
}

/** Everything one Market Watch run carries between its steps. */
type WatchRun = {
  tenant: TenantContext;
  request: MarketWatchRequest;
  model: string;
  /** The person picked `model` (`modelPinned`): a failure is then the answer, never a stand-in. */
  modelExplicit: boolean;
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

/** What the team stage produced, or nothing at all when the run was `quick`. */
type TeamOutcome = { notes?: TeamNotes; failures: string[] };
const NO_TEAM: TeamOutcome = { failures: [] };

/** The draft and the model that wrote it: after a fallback that is the stand-in, and it is what gets recorded. */
type Drafted = { raw: string; answeredBy: string };

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
async function draftBriefing(run: WatchRun, packet: MarketWatchPacket): Promise<Drafted> {
  const { tenant, request, model, modelExplicit, resolved, emit, abortSignal } = run;
  emit({ type: "job.phase", phase: "drafting", label: "Drafting the briefing" });
  const stopHeartbeat = startDraftingHeartbeat(emit);
  let answer: Answer;
  try {
    const reply = await withClientAbort(
      () =>
        resolved.ask({
          tenant,
          model,
          modelExplicit,
          signal: abortSignal,
          systemPrompt: buildWatchSystemPrompt({
            language: request.language,
            maxChars: request.maxChars,
            clockNote: packet.clock.note,
            specialist: request.specialist,
          }),
          runPrefix: "market",
          agentId: "market",
          jobMode: "market",
          versionId: "market-briefing",
          prompt: briefingPrompt(packet, request.prompt, request.specialist),
          toolKeys: toolKeysFor(request.specialist, resolved.webReady()),
          streamWatchdog: MARKET_STREAM_WATCHDOG,
        }),
      abortSignal,
    );
    answer = answerOf(reply, model);
  } finally {
    stopHeartbeat();
  }
  if (!answer.text.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyMarketBriefing", localeForRun()), 502);
  }
  return { raw: answer.text, answeredBy: answer.model };
}

/**
 * The analyst team: four analysts on their own slices, a bull, a bear, one risk
 * read and the editor's synthesis — `TEAM_MAX_CALLS` model calls at most.
 *
 * A desk whose harness names no analysts (scanner, sector-rotation,
 * elliott-wave) cannot run a team, so the run falls back to the quick draft and
 * says so in `failures` rather than refusing the request.
 */
async function draftWithTeam(run: WatchRun, packet: MarketWatchPacket): Promise<Drafted & { team: TeamOutcome }> {
  const { tenant, request, model, modelExplicit, resolved, emit, abortSignal } = run;
  if (!teamAvailable(request.specialist)) {
    return {
      ...(await draftBriefing(run, packet)),
      team: { failures: [`team: the ${request.specialist} desk has no analyst team; wrote a quick briefing instead`] },
    };
  }
  // The pipeline's last call is the editor's synthesis, which is the briefing: the model that
  // answered last is the one the artifact names.
  let answeredBy = model;
  const ask: TeamAsk = async (call) => {
    const reply = await withClientAbort(
      () =>
        resolved.ask({
          tenant,
          model,
          modelExplicit,
          signal: abortSignal,
          systemPrompt: call.systemPrompt,
          runPrefix: "market-team",
          agentId: "market",
          jobMode: "market",
          versionId: call.versionId,
          prompt: call.prompt,
          toolKeys: call.toolKeys,
          streamWatchdog: MARKET_STREAM_WATCHDOG,
        }),
      abortSignal,
    );
    const answer = answerOf(reply, model);
    answeredBy = answer.model;
    return answer.text;
  };
  const result = await runTeamPipeline({
    packet,
    specialist: request.specialist,
    language: request.language,
    instruction: request.prompt,
    analysts: analystsFor(request.specialist),
    ask,
    emit,
    // Only the editor keeps the desk's tools; the analysts read their slice and nothing else.
    synthesisToolKeys: toolKeysFor(request.specialist, resolved.webReady()),
  });
  if (result.calls > TEAM_MAX_CALLS) {
    // Unreachable: the pipeline enforces the ceiling itself. Kept so a regression is loud.
    throw new ApiError("generation_failed", `market: the team made ${result.calls} calls`, 500);
  }
  if (!result.raw.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyMarketBriefing", localeForRun()), 502);
  }
  emit({ type: "job.step", phase: "synthesis", label: `${result.calls}/${TEAM_MAX_CALLS} model calls` });
  return { raw: result.raw, answeredBy, team: { notes: result.notes, failures: result.failures } };
}

/** Parse the draft and run both guards (numbers, advice) on every section and on the stored team notes. */
function verifyBriefing(
  run: WatchRun,
  raw: string,
  packet: MarketWatchPacket,
  team: TeamOutcome = NO_TEAM,
): VerifiedBriefing {
  const { request, resolved, emit } = run;
  emit({ type: "job.phase", phase: "verifying", label: "Checking every figure and sentence" });
  const verified = buildMarketBriefing(parseBriefingDraft(raw), packet, {
    language: request.language,
    specialist: request.specialist,
    // A team run that fell back to a quick draft is a quick briefing, and says so.
    depth: team.notes ? "team" : "quick",
    ...(team.notes ? { team: guardTeamNotes(team.notes, allowedNumbers(packet)) } : {}),
    generatedAt: resolved.now().toISOString(),
  });
  emit({ type: "job.step", phase: "verifying", label: guardLabel(verified.guard) });
  return verified;
}

/**
 * Final advice gate, markdown, the `market` / `briefing` artifact, and the automatic work card.
 *
 * The card is the same auto-ingest every other analyst desk writes at this point (Finance, Data,
 * Legal): without it a briefing was invisible to Chat unless the user noticed the "Send to
 * Knowledge Base" button. `upsertWorkSource` is idempotent on the artifact origin and never
 * throws, so a Knowledge Base that is down cannot lose a briefing that already generated.
 */
async function saveBriefing(
  run: WatchRun,
  verified: VerifiedBriefing,
  loaded: LoadedPacket,
  answeredBy: string,
): Promise<MarketWatchResult> {
  const { tenant, request, resolved, emit } = run;
  const { briefing, guard } = verified;
  const { packet, failures, tickerFailures } = loaded;
  emit({ type: "job.phase", phase: "saving", label: "Saving briefing" });
  assertBriefingHasNoAdvice(briefing.sections);
  const markdown = marketBriefingMarkdown(briefing);
  const artifactId = persistBriefing(resolved.artifacts(), tenant, briefing, markdown, {
    tickers: packet.tickers.map((ticker) => ticker.symbol.yahoo),
    question: request.prompt,
    // The model that wrote the briefing. After a fallback the requested id is the one that did not.
    model: answeredBy,
    language: request.language,
    specialist: request.specialist,
    depth: briefing.depth,
    ...(briefing.team
      ? { analysts: briefing.team.analysts.map((note) => note.analyst), teamRounds: briefing.team.rounds }
      : {}),
    generatedAt: briefing.generatedAt,
    usSession: packet.clock.usSession,
    flagged: guard.total,
    adviceReplaced: guard.adviceReplaced,
    guardedSections: briefing.guardedSections,
    sourceCount: briefing.sources.length,
    failures: [...failures, ...tickerFailures],
  });
  if (artifactId) {
    await resolved.ingest(
      tenant,
      artifactWorkCard({
        type: "Market",
        artifactId,
        title: briefing.title,
        prompt: request.prompt,
        markdown,
        model: answeredBy,
      }),
    );
  }
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
  const settings = requireLive(tenant);
  const run: WatchRun = {
    tenant,
    request,
    model: resolveModel(request.model, settings),
    modelExplicit: readModelPinned(request),
    resolved: resolveDeps(deps),
    emit,
    abortSignal,
  };

  throwIfJobAborted(abortSignal);
  const loaded = await loadPacket(run);
  throwIfJobAborted(abortSignal);
  const drafted =
    request.depth === "team"
      ? await draftWithTeam(run, loaded.packet)
      : { ...(await draftBriefing(run, loaded.packet)), team: NO_TEAM };
  throwIfJobAborted(abortSignal);
  const verified = verifyBriefing(run, drafted.raw, loaded.packet, drafted.team);
  throwIfJobAborted(abortSignal);
  return await saveBriefing(
    run,
    verified,
    {
      ...loaded,
      failures: [...loaded.failures, ...drafted.team.failures],
    },
    drafted.answeredBy,
  );
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
    packetToPromptBlock(briefing.packet, briefing.specialist),
    // A team section was written over these notes; without them the rewrite could not keep attributing.
    ...(briefing.team ? [`TEAM NOTES:\n${JSON.stringify(briefing.team, null, 2)}`] : []),
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
  const settings = requireLive(tenant);
  const model = resolveModel(typeof record.model === "string" ? record.model : undefined, settings);
  const resolved = resolveDeps(deps);

  const reply = await resolved.ask({
    tenant,
    model,
    // A rewrite model the person picked is never swapped by the fallback; a seeded one can be.
    modelExplicit: readModelPinned(record),
    systemPrompt:
      briefing.depth === "team"
        ? teamSectionSystemPrompt(briefing)
        : sectionSystemPrompt({
            language: briefing.language,
            maxChars: SECTION_MAX_CHARS,
            clockNote: briefing.packet.clock.note,
            // A rewritten section must obey the same desk's rules as the briefing around it.
            specialist: briefing.specialist,
          }),
    runPrefix: "market-section",
    agentId: "market",
    jobMode: "market",
    versionId: "market-section",
    prompt: appendRegenInstruction(sectionPrompt(briefing, index, current), readOptionalInstruction(record)),
    toolKeys: toolKeysFor(briefing.specialist, resolved.webReady()),
    streamWatchdog: MARKET_STREAM_WATCHDOG,
  });
  const raw = answerOf(reply, model).text;
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
