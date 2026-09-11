import type { TenantContext } from "@agentforge/core";
import {
  BackendUnavailable,
  type BackendHealth,
  type BackendRetrieveOptions,
  type BackendSource,
  type KnowledgeBackend,
  type RetrieveResult,
} from "../../backend";
import {
  getExternalId,
  setExternalId,
  sourceByExternalId,
  sourceById,
  type WorkspaceBinding,
} from "../../backend-store";
import { enqueueOutbox, failOutbox, pendingOutbox, removeOutbox, type OutboxEntry } from "../../outbox";
import { sql } from "@agentforge/db";
import { WeKnoraClient } from "./client";
import { bootstrapWorkspace, ensureTenant, forgetTenant, forgetVerifiedBinding, gatewayFor } from "./bootstrap";
import { customMetadataFor, mapSearchHits } from "./mapper";
import { flushModelRevocations, revokeWorkspaceModel } from "./revoke";
import { weknoraSupervisor, type SidecarHandle } from "./supervisor";

/**
 * The second implementation of `KnowledgeBackend`: vectors and hybrid scoring live in the bundled
 * WeKnora sidecar, everything else stays in agentforge SQLite.
 *
 * Two contracts it must not break. `indexSource` and `deleteSource` never throw — the FTS rows
 * were already written by the caller and a dead sidecar must not fail an ingest — so a failed
 * write lands in `knowledge_backend_outbox` instead. `retrieve` *does* throw
 * `BackendUnavailable`, because an empty result set and "the engine is down" look identical to a
 * caller and only one of them should fall back to the built-in backend.
 */

/** Chunks are rejoined into one Markdown document: WeKnora does its own chunking on ingest. */
const CHUNK_JOIN = "\n\n";
/** How many outbox rows one drain attempts. Bounded so a drain never becomes a long request. */
export const DRAIN_BATCH = 20;

type Connection = { client: WeKnoraClient; binding: WorkspaceBinding; kbId: string };

export class WeKnoraBackend implements KnowledgeBackend {
  readonly id = "weknora" as const;

  constructor(private readonly sidecar: SidecarHandle = weknoraSupervisor()) {}

  /**
   * A ready, authenticated client bound to this workspace's knowledge base.
   *
   * Nothing is cached across calls except what is already persisted (credentials in settings, the
   * KB id in `knowledge_workspace_backend`): the sidecar's port changes on every restart, so a
   * cached base URL is a wrong answer waiting to happen, and the supervisor already short-circuits
   * when the process is up.
   */
  private async connect(tenant: TenantContext): Promise<Connection> {
    const baseUrl = await this.sidecar.baseUrl();
    const anonymous = new WeKnoraClient(baseUrl);
    try {
      return await this.bind(tenant, anonymous);
    } catch (error) {
      // A key the sidecar does not recognise means its database was reset under us. Forget it once
      // and re-bootstrap; a second failure is a real outage.
      if (error instanceof BackendUnavailable && error.reason === "http_401") {
        forgetTenant();
        return this.bind(tenant, anonymous);
      }
      if (error instanceof BackendUnavailable && error.reason === "http_404") {
        // The knowledge base we had verified is gone; the cached binding is now a lie.
        forgetVerifiedBinding(tenant.workspaceId);
      }
      throw error;
    }
  }

  private async bind(tenant: TenantContext, anonymous: WeKnoraClient): Promise<Connection> {
    // The gateway key travels inside the model row we create, so it is one of the strings an error
    // body from this sidecar could echo back. Told to the client here, stripped from every log.
    const withSecrets = anonymous.withLogSecrets([gatewayFor(tenant).apiKey]);
    const { credentials, binding } = await bootstrapWorkspace(tenant, withSecrets);
    return {
      client: withSecrets.withCredentials(credentials),
      binding,
      kbId: binding.kbId ?? "",
    };
  }

  /**
   * An authenticated client that does *not* bootstrap a binding.
   *
   * Revocation needs exactly this: `connect` would helpfully recreate the model row we are in the
   * middle of deleting, which is the opposite of revoking it.
   */
  private async tenantClient(tenant: TenantContext): Promise<WeKnoraClient> {
    const anonymous = new WeKnoraClient(await this.sidecar.baseUrl()).withLogSecrets([gatewayFor(tenant).apiKey]);
    return anonymous.withCredentials(await ensureTenant(anonymous));
  }

  /**
   * Take this desk's gateway key back out of the sidecar's database.
   *
   * Called when WeKnora is deselected and when the gateway key or base URL changes. Never throws,
   * and never silently gives up: a row it could not delete now is queued and deleted on the next
   * connection, because a key that is still in a third-party database has not been revoked.
   */
  async revokeGatewayModel(tenant: TenantContext): Promise<void> {
    await revokeWorkspaceModel(tenant, async (modelId) => {
      const client = await this.tenantClient(tenant);
      await client.deleteModel(modelId);
    });
  }

  /** Index (or re-index) one source. Never throws: a failure is queued, not raised. */
  async indexSource(tenant: TenantContext, source: BackendSource, chunks: string[], model: string): Promise<void> {
    try {
      await this.writeSource(tenant, source, chunks);
    } catch (error) {
      // The handle goes with the write. What the sidecar still holds for this id was built from the
      // previous body, and a hit on it would be attributed to a source that no longer says that.
      setExternalId(tenant, source.id, null);
      enqueueOutbox(tenant, {
        op: "index",
        sourceId: source.id,
        payload: JSON.stringify({ model }),
      });
      warn(`index ${source.id} queued`, error);
    }
  }

  private async writeSource(tenant: TenantContext, source: BackendSource, chunks: string[]): Promise<void> {
    const { client, kbId } = await this.connect(tenant);
    // Upsert is delete-then-create by external id: WeKnora has no "replace this document" call, and
    // leaving the old one would double every chunk of a re-indexed card in the result set.
    const previous = getExternalId(tenant, source.id);
    if (previous) {
      await client.deleteKnowledge(previous);
      setExternalId(tenant, source.id, null);
    }
    const origin = originOf(tenant, source.id);
    const knowledge = await client.ingestManual({
      kbId,
      title: source.name,
      content: chunks.join(CHUNK_JOIN),
      metadata: customMetadataFor({
        workspaceId: tenant.workspaceId,
        sourceId: source.id,
        originKind: origin.kind,
        originId: origin.id,
        // The row version this document was built from: a write that lands after a newer re-index
        // is visibly stale rather than silently authoritative.
        externalRef: String(source.createdAt),
      }),
    });
    setExternalId(tenant, source.id, knowledge.id);
  }

  /** Forget one source. Never throws; a failure is queued so the delete is not simply lost. */
  async deleteSource(tenant: TenantContext, sourceId: string, handle?: string | null): Promise<void> {
    // The caller's handle wins: it was read before the SQLite row was dropped, and the lookup here
    // would find nothing at all for the common case of a source that has just been deleted.
    const externalId = handle ?? getExternalId(tenant, sourceId);
    if (!externalId) {
      return;
    }
    try {
      const { client } = await this.connect(tenant);
      await client.deleteKnowledge(externalId);
      setExternalId(tenant, sourceId, null);
    } catch (error) {
      enqueueOutbox(tenant, { op: "delete", sourceId, externalId });
      warn(`delete ${sourceId} queued`, error);
    }
  }

  async retrieve(tenant: TenantContext, query: string, opts: BackendRetrieveOptions): Promise<RetrieveResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { chunks: [], mode: "none", backend: this.id, vectorModel: null };
    }
    const { client, kbId, binding } = await this.connect(tenant);
    const hits = await client.hybridSearch({ kbId, query: trimmed, limit: opts.limit });
    const exclude = new Set(opts.excludeSourceIds ?? []);
    const chunks = mapSearchHits(hits, tenant.workspaceId, {
      bySourceId: (id) => sourceById(tenant, id),
      byExternalId: (id) => sourceByExternalId(tenant, id),
    })
      .filter((chunk) => !exclude.has(chunk.sourceId))
      .slice(0, opts.limit);
    return {
      chunks,
      mode: chunks.length > 0 ? "weknora" : "none",
      backend: this.id,
      vectorModel: binding.embeddingModel,
    };
  }

  /**
   * Everything a first flag flip needs, done once and reported: spawn, auto-setup, API key, model
   * row, knowledge base. Separate from `health` because it is slow and only the flag flip (and the
   * first knowledge call) should pay for it.
   */
  async prepare(tenant: TenantContext): Promise<BackendHealth> {
    try {
      const connection = await this.connect(tenant);
      // A flag flip is the natural moment to settle anything a previous revocation could not.
      await flushModelRevocations(connection.client);
      return { ok: true, detail: `knowledge base ${connection.kbId}` };
    } catch (error) {
      // Reason only. `detail` is serialised into `GET /api/v1/knowledge` and rendered on the
      // Knowledge page, and the messages behind a `BackendUnavailable` quote the sidecar's own
      // error body — third-party text, in a response we handed an API key to. The body is logged
      // (redacted) by the client instead; see client.ts `readBody`.
      if (error instanceof BackendUnavailable) {
        return { ok: false, detail: error.reason };
      }
      return { ok: false, detail: "bootstrap failed" };
    }
  }

  /**
   * Sidecar up and answering its own protocol. Binary resolution is *not* repeated here: the
   * supervisor already rejects with `BackendUnavailable("not_staged")` when there is nothing to
   * spawn, and asking twice would make an injected sidecar (tests, and a future external server)
   * unreportable even while it is plainly answering.
   */
  async health(): Promise<BackendHealth> {
    try {
      const baseUrl = await this.sidecar.baseUrl();
      const ok = await new WeKnoraClient(baseUrl).health();
      return ok ? { ok: true, detail: "sidecar ready" } : { ok: false, detail: "health check failed" };
    } catch (error) {
      if (error instanceof BackendUnavailable) {
        return { ok: false, detail: error.reason };
      }
      return { ok: false, detail: "unavailable" };
    }
  }

  /**
   * Replay what the backend missed while it was down. Returns how many rows it cleared.
   * Never throws: it runs from a health transition and from `GET /api/v1/knowledge`, and neither
   * of those may fail because a replay did.
   */
  async drainOutbox(tenant: TenantContext, limit = DRAIN_BATCH): Promise<number> {
    let drained = 0;
    try {
      await flushModelRevocations(await this.tenantClient(tenant));
    } catch (error) {
      warn("queued model revocations not flushed", error);
    }
    for (const entry of pendingOutbox(tenant, limit)) {
      try {
        await this.replay(tenant, entry);
        removeOutbox(tenant, entry.id);
        drained += 1;
      } catch (error) {
        failOutbox(tenant, entry);
        warn(`outbox replay ${entry.op} ${entry.sourceId} failed`, error);
        // The sidecar is still unhappy; the rest of the batch would fail the same way.
        break;
      }
    }
    return drained;
  }

  private async replay(tenant: TenantContext, entry: OutboxEntry): Promise<void> {
    if (entry.op === "delete") {
      const { client } = await this.connect(tenant);
      if (entry.externalId) {
        await client.deleteKnowledge(entry.externalId);
      }
      setExternalId(tenant, entry.sourceId, null);
      return;
    }
    const source = indexableSource(tenant, entry.sourceId);
    if (!source) {
      // The source was deleted after the index was queued: nothing to replay, and the delete side
      // was queued (or already applied) separately.
      return;
    }
    await this.writeSource(tenant, source.source, source.chunks);
  }
}

/** The origin columns of a source row, used to stamp the document's custom metadata. */
function originOf(tenant: TenantContext, sourceId: string): { kind: string | null; id: string | null } {
  try {
    const row = sql
      .prepare("SELECT origin_kind, origin_id FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
      .get(tenant.workspaceId, sourceId) as { origin_kind: string | null; origin_id: string | null } | undefined;
    return { kind: row?.origin_kind ?? null, id: row?.origin_id ?? null };
  } catch {
    return { kind: null, id: null };
  }
}

/**
 * A source and its chunk bodies, read back from SQLite so a replay does not need the original
 * request.
 *
 * `knowledge_vectors` is preferred because it carries an explicit `chunk_index`; it is empty for
 * sources that were only ever indexed under this backend, so the fallback reads the FTS5 table —
 * through a `source_id:"..."` column filter, never an unqualified select, which has no MATCH for
 * FTS5 to plan against and degrades to a scan of the whole workspace's chunks. Inside one source,
 * rowid order is insert order, which is the order the chunker produced.
 */
export function indexableSource(
  tenant: TenantContext,
  sourceId: string,
): { source: BackendSource; chunks: string[] } | null {
  try {
    const row = sql
      .prepare("SELECT id, name, created_at, status FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
      .get(tenant.workspaceId, sourceId) as
      | { id: string; name: string; created_at: number; status: string }
      | undefined;
    if (row?.status !== "Indexed") {
      return null;
    }
    const chunks = chunkBodies(tenant, sourceId);
    if (chunks.length === 0) {
      return null;
    }
    return {
      source: { id: row.id, name: row.name, createdAt: row.created_at },
      chunks,
    };
  } catch (error) {
    warn(`source ${sourceId} could not be read for re-index`, error);
    return null;
  }
}

function chunkBodies(tenant: TenantContext, sourceId: string): string[] {
  const vectors = sql
    .prepare(`SELECT body FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ? ORDER BY chunk_index`)
    .all(tenant.workspaceId, sourceId) as Array<{ body: string }>;
  if (vectors.length > 0) {
    return vectors.map((chunk) => chunk.body);
  }
  const match = `source_id:"${sourceId.replace(/"/g, "")}"`;
  const rows = sql
    .prepare(`SELECT body FROM knowledge_chunks WHERE knowledge_chunks MATCH ? AND workspace_id = ? ORDER BY rowid`)
    .all(match, tenant.workspaceId) as Array<{ body: string }>;
  return rows.map((chunk) => chunk.body);
}

function warn(what: string, error: unknown): void {
  console.warn(`knowledge-weknora: ${what} (${error instanceof Error ? error.message.slice(0, 160) : "error"})`);
}
