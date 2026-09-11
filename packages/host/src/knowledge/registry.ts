import type { TenantContext } from "@agentforge/core";
import { loadSettings, saveSettings } from "../settings-store";
import {
  BackendUnavailable,
  isBackendUnavailable,
  type BackendRetrieveOptions,
  type BackendSource,
  type KnowledgeBackend,
  type KnowledgeBackendId,
  type RetrieveResult,
} from "./backend";
import { setExternalId } from "./backend-store";
import { SqliteBuiltinBackend } from "./backends/builtin";
import { WeKnoraBackend } from "./backends/weknora/backend";
import { weknoraAvailable } from "./backends/weknora/binary";
import { enqueueOutbox, hasOutboxEntry, outboxDepth } from "./outbox";

/**
 * Which engine answers, and what happens when it cannot.
 *
 * The setting is a preference, not a promise. WeKnora answers only while it is selected, staged and
 * healthy; after `FAILURES_BEFORE_DEGRADED` consecutive failures the built-in backend takes over
 * for `DEGRADED_MS`, ingests keep dual-writing SQLite and queue the WeKnora half in the outbox, and
 * the Sources line says `(degraded)` out loud. A knowledge base that quietly answers with less than
 * it knows is the failure mode this whole arrangement exists to avoid.
 */

/** Consecutive retrieval failures before the built-in backend takes over. */
export const FAILURES_BEFORE_DEGRADED = 3;
/** How long it stays taken over before the selected backend is tried again. */
export const DEGRADED_MS = 60_000;

/**
 * The whole budget a Chat turn gives the remote backend, cold start included.
 *
 * Every step below this has its own timeout - 20 s to spawn, 30 s to bootstrap, 10 s to search -
 * and they *chain*: a sidecar that is slow rather than dead can spend a minute inside one
 * `retrieve` before anything gives up, with the owner staring at a Chat turn that has not started.
 * This is the deadline that matters, because it is the one the owner experiences. Blowing it counts
 * as a failure (so three of them degrade the desk) and the built-in backend answers instead.
 */
export const RETRIEVE_DEADLINE_MS = 5_000;
/**
 * The same idea for the write path, with the budget an embed actually needs. An ingest that blows
 * it is queued in the outbox rather than failed: the FTS rows are already committed, so the card
 * exists and only the vector half is late.
 */
export const INDEX_DEADLINE_MS = 30_000;

let builtin: SqliteBuiltinBackend | null = null;
let weknora: WeKnoraBackend | null = null;

let consecutiveFailures = 0;
let degradedUntil = 0;
let lastFailureReason: string | null = null;

/**
 * One total deadline over a whole backend call, however many round trips it is made of.
 * Rejects with `BackendUnavailable`, which is the one error the callers below fall back on.
 */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new BackendUnavailable("weknora", "timeout", `WeKnora ${what} exceeded ${ms} ms`));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function builtinBackend(): SqliteBuiltinBackend {
  builtin ??= new SqliteBuiltinBackend();
  return builtin;
}

export function weknoraBackend(): WeKnoraBackend {
  weknora ??= new WeKnoraBackend();
  return weknora;
}

/** Test hook: swap in a backend that talks to a fake server instead of spawning a sidecar. */
export function setWeknoraBackendForTests(backend: WeKnoraBackend | null): void {
  weknora = backend;
  resetBackendHealthForTests();
}

export function resetBackendHealthForTests(): void {
  consecutiveFailures = 0;
  degradedUntil = 0;
  lastFailureReason = null;
  draining.clear();
}

/** What the desk asked for. An unknown value on disk already normalized to undefined = builtin. */
export function selectedBackendId(): KnowledgeBackendId {
  try {
    return loadSettings().knowledgeBackend ?? "builtin";
  } catch {
    return "builtin";
  }
}

export function putSelectedBackendId(id: KnowledgeBackendId): KnowledgeBackendId {
  saveSettings({ knowledgeBackend: id });
  resetBackendHealthForTests();
  return id;
}

function isDegraded(now = Date.now()): boolean {
  return now < degradedUntil;
}

export type BackendState = {
  /** Who is answering right now. */
  id: KnowledgeBackendId;
  /** What the setting says. */
  selected: KnowledgeBackendId;
  available: boolean;
  reason: string | null;
  degraded: boolean;
};

export function knowledgeBackendState(): BackendState {
  const selected = selectedBackendId();
  if (selected === "builtin") {
    return { id: "builtin", selected, available: true, reason: null, degraded: false };
  }
  const binary = weknoraAvailable();
  const degraded = isDegraded();
  return {
    id: binary.available && !degraded ? "weknora" : "builtin",
    selected,
    available: binary.available,
    reason: binary.reason ?? (degraded ? (lastFailureReason ?? "degraded") : null),
    degraded: binary.available && degraded,
  };
}

/**
 * The backend this host uses right now. One instance per process per implementation: backends own a
 * supervisor and a client, so callers must never construct their own.
 */
export function getKnowledgeBackend(): KnowledgeBackend {
  return knowledgeBackendState().id === "weknora" ? weknoraBackend() : builtinBackend();
}

function noteSuccess(): void {
  consecutiveFailures = 0;
  degradedUntil = 0;
  lastFailureReason = null;
}

/** Count one failure; the third in a row hands retrieval to the built-in backend for a minute. */
function noteFailure(reason: string): void {
  consecutiveFailures += 1;
  lastFailureReason = reason;
  if (consecutiveFailures >= FAILURES_BEFORE_DEGRADED) {
    degradedUntil = Date.now() + DEGRADED_MS;
  }
}

/**
 * Retrieve through the selected backend, falling back to the built-in one when it cannot answer.
 *
 * Only `BackendUnavailable` falls back. A backend that raises anything else has a bug, and hiding
 * it behind a silently different result set is how a bug becomes a mystery.
 */
export async function retrieveThroughBackend(
  tenant: TenantContext,
  query: string,
  opts: BackendRetrieveOptions,
): Promise<RetrieveResult> {
  const state = knowledgeBackendState();
  if (state.id === "builtin") {
    const result = await builtinBackend().retrieve(tenant, query, opts);
    // A desk that asked for WeKnora and is being answered by FTS is degraded whether the sidecar
    // failed three times or was never installed. Either way the Sources line has to say so.
    return state.selected === "builtin" ? result : { ...result, degraded: true };
  }
  try {
    const result = await withDeadline(
      weknoraBackend().retrieve(tenant, query, opts),
      RETRIEVE_DEADLINE_MS,
      "retrieval",
    );
    noteSuccess();
    void drainKnowledgeOutbox(tenant);
    return result;
  } catch (error) {
    if (!isBackendUnavailable(error)) {
      throw error;
    }
    noteFailure(error.reason);
    console.warn(`knowledge-registry: weknora retrieval failed (${error.reason}), answering from FTS`);
    const fallback = await builtinBackend().retrieve(tenant, query, opts);
    return { ...fallback, degraded: true };
  }
}

/**
 * Index one source through whichever backend is answering.
 *
 * While degraded the built-in vectors are written *and* the WeKnora write is queued: the desk keeps
 * a working hybrid answer immediately, and the sidecar catches up when it comes back. Never throws
 * — the FTS rows are already committed by the caller and an ingest must not fail on the index side.
 */
export async function indexThroughBackend(
  tenant: TenantContext,
  source: BackendSource,
  chunks: string[],
  model: string,
): Promise<void> {
  const state = knowledgeBackendState();
  // The built-in vectors are written *first, always*, even while WeKnora is perfectly healthy.
  // Delegating instead would leave every source indexed under WeKnora with no local vectors, so the
  // fallback the whole degraded path depends on would be FTS-only - and flipping the flag back to
  // builtin would silently lose the hybrid half of the answer for everything ingested in between.
  await builtinBackend().indexSource(tenant, source, chunks, model);
  if (state.id !== "weknora") {
    if (state.selected === "weknora") {
      queueIndex(tenant, source.id, model);
    }
    return;
  }
  try {
    await withDeadline(weknoraBackend().indexSource(tenant, source, chunks, model), INDEX_DEADLINE_MS, "index");
  } catch (error) {
    // `indexSource` queues its own failures, so this is the deadline (or a bug) rather than a
    // rejected write; either way the WeKnora half is owed and belongs in the outbox.
    queueIndex(tenant, source.id, model);
    noteFailure(isBackendUnavailable(error) ? error.reason : "index_failed");
    return;
  }
  // A write-rejecting sidecar throws nothing - it queues - so the honest signal that it failed is
  // the handle it was supposed to write. Without this a sidecar that accepts reads and refuses
  // writes never degrades, and every ingest quietly piles up in the outbox.
  if (hasOutboxEntry(tenant, source.id)) {
    noteFailure("index_failed");
  }
}

/**
 * Queue the WeKnora half of an index, and drop the handle that no longer describes this source.
 *
 * The document the backend still holds was built from the *previous* body. Leaving `external_id`
 * pointing at it lets the mapper attribute a hit on that stale text to this (rewritten) source, so
 * the desk would cite the old answer under the new card's name. The drain sets a fresh handle when
 * the write finally lands.
 */
function queueIndex(tenant: TenantContext, sourceId: string, model: string): void {
  setExternalId(tenant, sourceId, null);
  enqueueOutbox(tenant, { op: "index", sourceId, payload: JSON.stringify({ model }) });
}

/**
 * Forget one source everywhere it could be held. Both backends are asked regardless of selection:
 * a desk that flipped the flag last week still has rows from before it, and a delete that only
 * reaches the current engine leaves the other one able to serve a card the owner deleted.
 */
export async function deleteThroughBackend(
  tenant: TenantContext,
  sourceId: string,
  externalId?: string | null,
): Promise<void> {
  await builtinBackend().deleteSource(tenant, sourceId);
  if (selectedBackendId() !== "weknora") {
    return;
  }
  try {
    await withDeadline(weknoraBackend().deleteSource(tenant, sourceId, externalId), INDEX_DEADLINE_MS, "delete");
  } catch (error) {
    enqueueOutbox(tenant, { op: "delete", sourceId, externalId: externalId ?? null });
    noteFailure(isBackendUnavailable(error) ? error.reason : "delete_failed");
    return;
  }
  // Same rule as an index: a delete the sidecar refused is queued, not thrown, so the queue is
  // what says it failed. A backend that cannot forget must degrade like one that cannot answer.
  if (hasOutboxEntry(tenant, sourceId)) {
    noteFailure("delete_failed");
  }
}

/**
 * One drain per desk at a time: a second trigger joins the run already in flight.
 *
 * Two drains over the same rows both read them as pending, both replay them, and the second
 * `writeSource` creates a *third* document while `external_id` can only remember one - the other is
 * orphaned in the sidecar, holding our text, reachable by nothing. The trigger points are a
 * retrieval and a page load, which is exactly the pair that arrives together.
 */
const draining = new Map<string, Promise<number>>();

/** Replay queued WeKnora writes. Never throws; returns how many rows it cleared. */
export function drainKnowledgeOutbox(tenant: TenantContext): Promise<number> {
  if (selectedBackendId() !== "weknora" || outboxDepth(tenant) === 0) {
    return Promise.resolve(0);
  }
  const key = tenant.workspaceId;
  const existing = draining.get(key);
  if (existing) {
    return existing;
  }
  const pending = runDrain(tenant).finally(() => {
    draining.delete(key);
  });
  draining.set(key, pending);
  return pending;
}

async function runDrain(tenant: TenantContext): Promise<number> {
  try {
    return await weknoraBackend().drainOutbox(tenant);
  } catch (error) {
    console.warn(
      `knowledge-registry: outbox drain failed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return 0;
  }
}
