import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import {
  deleteSource,
  findSourceByOrigin,
  indexKnowledgeSource,
  retrieveChunks,
  type SourceOrigin,
} from "./knowledge";

/**
 * The Verified stage of the knowledge loop: prove, on demand, that a fact written into this
 * workspace comes back out of it. The check plants a source with a token that exists nowhere else,
 * asks for it, and deletes the source again — so it measures the real ingest and retrieval path
 * rather than a mock, and leaves the workspace exactly as it found it.
 *
 * It never throws. A knowledge base that cannot answer is a *result*, not an exception: the caller
 * gets `{ ok: false, detail }` and the Knowledge page can show why.
 */

/** Fixed origin, so a re-run replaces the previous plant instead of stacking up copies. */
export const SELF_CHECK_ORIGIN: SourceOrigin = { kind: "artifact", id: "self-check" };

const SELF_CHECK_NAME = "Self-check";
const SELF_CHECK_TYPE = "Verify";

/** Detail strings are shown verbatim in the UI, so a driver error is trimmed to one short line. */
const DETAIL_MAX = 200;

export type KnowledgeVerifyRecord = { ok: boolean; at: number; detail: string };

const UPSERT_VERIFY = `INSERT INTO knowledge_verify (workspace_id, ok, detail, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(workspace_id) DO UPDATE SET
    ok = excluded.ok, detail = excluded.detail, created_at = excluded.created_at`;

/** The last self-check for this workspace, or null when it has never run. */
export function getKnowledgeVerify(tenant: TenantContext): KnowledgeVerifyRecord | null {
  try {
    const row = sql
      .prepare("SELECT ok, detail, created_at FROM knowledge_verify WHERE workspace_id = ?")
      .get(tenant.workspaceId) as { ok: number; detail: string; created_at: number } | undefined;
    return row ? { ok: row.ok === 1, at: row.created_at, detail: row.detail } : null;
  } catch (error) {
    console.warn(
      `knowledge-verify: read failed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return null;
  }
}

function save(tenant: TenantContext, record: KnowledgeVerifyRecord): KnowledgeVerifyRecord {
  try {
    sql.prepare(UPSERT_VERIFY).run(tenant.workspaceId, record.ok ? 1 : 0, record.detail, record.at);
  } catch (error) {
    console.warn(
      `knowledge-verify: not recorded (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
  }
  return record;
}

/** A token that cannot appear anywhere else in the workspace, so a hit proves retrieval. */
function plantedToken(): string {
  return `selfcheck${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Remove the plant whatever happened, including the row a previous crashed run may have left. */
function removePlant(tenant: TenantContext, sourceId: string | null): void {
  try {
    if (sourceId) {
      deleteSource(tenant, sourceId);
    }
    const leftover = findSourceByOrigin(tenant, SELF_CHECK_ORIGIN);
    if (leftover) {
      deleteSource(tenant, leftover.id);
    }
  } catch (error) {
    console.warn(
      `knowledge-verify: plant not removed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
  }
}

async function checkOnce(tenant: TenantContext): Promise<{ ok: boolean; detail: string; sourceId: string | null }> {
  const token = plantedToken();
  const existing = findSourceByOrigin(tenant, SELF_CHECK_ORIGIN);
  const started = Date.now();
  const source = await indexKnowledgeSource(tenant, {
    id: existing?.id ?? crypto.randomUUID(),
    name: SELF_CHECK_NAME,
    type: SELF_CHECK_TYPE,
    text: `Knowledge self-check. The planted token for this run is ${token}. It is deleted immediately.`,
    origin: SELF_CHECK_ORIGIN,
  });
  if (source.status !== "Indexed") {
    return { ok: false, detail: `plant not indexed: ${source.error ?? source.status}`, sourceId: source.id };
  }
  const result = await retrieveChunks(tenant, token, 4);
  const elapsed = Date.now() - started;
  const hit = result.chunks.find((chunk) => chunk.sourceId === source.id && chunk.body.includes(token));
  if (!hit) {
    return {
      ok: false,
      detail: `planted token not retrieved in ${elapsed} ms · mode ${result.mode}`,
      sourceId: source.id,
    };
  }
  return { ok: true, detail: `retrieved in ${elapsed} ms · mode ${result.mode}`, sourceId: source.id };
}

/**
 * One self-check per workspace at a time.
 *
 * The plant has a *fixed* origin, so two overlapping runs share one source row: the first run's
 * cleanup deletes the second's plant, and the second reports a knowledge base that cannot answer
 * its own question — a false alarm on the one screen whose job is to be trustworthy. A caller that
 * arrives while a run is in flight is handed that run's promise instead of starting a second.
 *
 * In-process only, which is the whole scope of the problem: the check runs in the host process.
 */
const inFlight = new Map<string, Promise<KnowledgeVerifyRecord>>();

/**
 * Run the planted-fact check and record the outcome. Returns the record it wrote; never throws.
 * Concurrent calls for one workspace share a single run and its result.
 */
export function runKnowledgeSelfCheck(tenant: TenantContext): Promise<KnowledgeVerifyRecord> {
  const key = tenant.workspaceId;
  const running = inFlight.get(key);
  if (running) {
    return running;
  }
  const run = selfCheckOnce(tenant).finally(() => {
    // Only clear our own entry: a later run may already have claimed the slot.
    if (inFlight.get(key) === run) {
      inFlight.delete(key);
    }
  });
  inFlight.set(key, run);
  return run;
}

async function selfCheckOnce(tenant: TenantContext): Promise<KnowledgeVerifyRecord> {
  let sourceId: string | null = null;
  try {
    const outcome = await checkOnce(tenant);
    sourceId = outcome.sourceId;
    return save(tenant, { ok: outcome.ok, at: Date.now(), detail: outcome.detail.slice(0, DETAIL_MAX) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "self-check failed";
    return save(tenant, { ok: false, at: Date.now(), detail: detail.slice(0, DETAIL_MAX) });
  } finally {
    removePlant(tenant, sourceId);
  }
}
