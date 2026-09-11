import type { TenantContext } from "@agentforge/core";
import { countSourcesMissingExternalId, getExternalId, sourcesMissingExternalId } from "./backend-store";
import { indexableSource } from "./backends/weknora/backend";
import { getKnowledgeModels } from "../knowledge";
import { selectedBackendId, weknoraBackend } from "./registry";

/**
 * Move a desk's existing knowledge into the WeKnora backend, a few sources at a time.
 *
 * Resumable by construction: "done" is `knowledge_sources.external_id` being set, so a backfill
 * that is interrupted — a quit, a crash, a sidecar that died halfway — simply picks up the sources
 * that still have no handle on the next run. Idempotent for the same reason: a source that already
 * has one is skipped, and `indexSource` is itself a delete-then-create by external id.
 *
 * It never throws. A failed source leaves its `external_id` null, which is exactly the state that
 * makes the next pass retry it.
 */

/** Sources per pass. Small: each one is an embed + HTTP round trip on the sidecar's own budget. */
export const BACKFILL_BATCH = 5;
/** Passes per run, so one call cannot loop over a large desk forever. */
const MAX_PASSES = 200;

/** One desk at a time: a second trigger joins the run in flight instead of doubling the load. */
const running = new Map<string, Promise<number>>();

/** How many sources this backend does not hold yet. */
export function backfillPending(tenant: TenantContext): number {
  return countSourcesMissingExternalId(tenant);
}

async function backfillPass(tenant: TenantContext, model: string): Promise<number> {
  const ids = sourcesMissingExternalId(tenant, BACKFILL_BATCH);
  let indexed = 0;
  for (const id of ids) {
    const readable = indexableSource(tenant, id);
    if (!readable) {
      continue;
    }
    await weknoraBackend().indexSource(tenant, readable.source, readable.chunks, model);
    // `indexSource` swallows its own failures into the outbox, so success is measured by the handle
    // it was supposed to write, not by the absence of a throw.
    if (getExternalId(tenant, id)) {
      indexed += 1;
    }
  }
  return indexed;
}

async function backfillLoop(tenant: TenantContext): Promise<number> {
  const model = getKnowledgeModels(tenant).embeddingModel;
  let total = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let indexed = 0;
    try {
      indexed = await backfillPass(tenant, model);
    } catch (error) {
      console.warn(
        `knowledge-backfill: pass failed (${error instanceof Error ? error.message.slice(0, 160) : "error"})`,
      );
      return total;
    }
    if (indexed === 0) {
      // Either nothing is left, or the sidecar is refusing every source. Both mean stop: the rows
      // that did not land are still pending and the next trigger will try them again.
      return total;
    }
    total += indexed;
  }
  return total;
}

/**
 * Run (or join) the backfill for this desk. Resolves with the number of sources it indexed.
 * Callers that do not want to wait — the reindex endpoint — just drop the promise.
 */
export function runBackfill(tenant: TenantContext): Promise<number> {
  const key = tenant.workspaceId;
  const existing = running.get(key);
  if (existing) {
    return existing;
  }
  const pending = backfillLoop(tenant).finally(() => {
    running.delete(key);
  });
  running.set(key, pending);
  return pending;
}

/**
 * Kick off a backfill in the background and report how much work it has to do.
 *
 * A desk that has not selected WeKnora queues nothing: pushing its whole knowledge base into a
 * backend it does not use would be work nobody asked for, against a sidecar that may not even be
 * installed. Select first, then reindex.
 */
export function startBackfill(tenant: TenantContext): { queued: number } {
  if (selectedBackendId() !== "weknora") {
    return { queued: 0 };
  }
  const queued = backfillPending(tenant);
  if (queued > 0) {
    void runBackfill(tenant).catch(() => {
      // `backfillLoop` already swallows and logs; this is belt and braces for an unhandled rejection.
    });
  }
  return { queued };
}
