/**
 * Every WeKnora field name this host knows, and the guards that check them at the wire boundary.
 *
 * Upstream ships breaking DTO changes every few weeks (see the plan's risk register), so the blast
 * radius of that churn is this one file plus `mapper.ts`: nothing above them ever names a WeKnora
 * field. Guards are hand-written and total — a response that does not match is a
 * `BackendUnavailable`, never a partially-trusted object, because the thing on the other end of a
 * loopback socket is only assumed to be our sidecar until it says something our sidecar would not.
 *
 * Shapes verified against Tencent/WeKnora at the pinned commit
 * `1edcd54b43606d9079bb36650efe3f68707a79ea` (v0.8.0).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Most endpoints answer `{success, data}`; `/auth/auto-setup` answers the payload at the top level.
 * Unwrapping only when the envelope is actually there keeps one code path for both.
 */
export function unwrapEnvelope(body: unknown): unknown {
  if (isRecord(body) && "data" in body && typeof body.success === "boolean") {
    return body.data;
  }
  return body;
}

/** `GET /health` → `{"status":"ok"}` (internal/router/router.go:131). */
export function isHealthPayload(body: unknown): boolean {
  return isRecord(body) && body.status === "ok";
}

export type AutoSetupResult = { token: string; tenantId: string };

/**
 * `POST /api/v1/auth/auto-setup` → `dto.AuthLoginResponse` at the *top level*.
 *
 * The tenant id is read from `memberships[0].tenant_id`, not `active_tenant.id`: the handler
 * tolerates a failed tenant reload and omits `active_tenant` entirely, while the membership row it
 * builds by hand is always there. It is a JSON number (Go `uint64`) that we carry as a string,
 * because it only ever travels back out as the `X-Tenant-ID` header.
 */
export function parseAutoSetup(body: unknown): AutoSetupResult | null {
  if (!isRecord(body)) {
    return null;
  }
  const token = str(body.token);
  if (!token) {
    return null;
  }
  const tenantId = tenantIdFrom(body);
  return tenantId ? { token, tenantId } : null;
}

function tenantIdFrom(body: Record<string, unknown>): string | null {
  const memberships = Array.isArray(body.memberships) ? body.memberships : [];
  for (const entry of memberships) {
    if (isRecord(entry)) {
      const id = num(entry.tenant_id) ?? str(entry.tenant_id);
      if (id !== null && String(id).length > 0 && String(id) !== "0") {
        return String(id);
      }
    }
  }
  const active = body.active_tenant;
  if (isRecord(active)) {
    const id = num(active.id) ?? str(active.id);
    if (id !== null && String(id) !== "0") {
      return String(id);
    }
  }
  return null;
}

/**
 * `POST /api/v1/tenants/:id/api-keys` → 201 `{success, data:{token, api_key, ...}}`.
 * `token` is the plaintext key; `api_key` holds the same value on create but is AES-encrypted at
 * rest, so it can come back empty on later reads. Only `token` is trusted here.
 */
export function parseApiKey(body: unknown): string | null {
  const data = unwrapEnvelope(body);
  if (!isRecord(data)) {
    return null;
  }
  return str(data.token) || str(data.api_key) || null;
}

/** Anything with a non-empty string `id`: models, knowledge bases and knowledge all answer this. */
export function parseId(body: unknown): string | null {
  const data = unwrapEnvelope(body);
  if (!isRecord(data)) {
    return null;
  }
  const id = str(data.id);
  return id && id.length > 0 ? id : null;
}

export type ModelRow = { id: string; name: string; type: string };

/** `GET /api/v1/models` → `{success, data:[ModelResponse]}`. */
export function parseModelList(body: unknown): ModelRow[] | null {
  const data = unwrapEnvelope(body);
  if (!Array.isArray(data)) {
    return null;
  }
  const rows: ModelRow[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) {
      return null;
    }
    const id = str(entry.id);
    const name = str(entry.name);
    if (!id || !name) {
      return null;
    }
    rows.push({ id, name, type: str(entry.type) ?? "" });
  }
  return rows;
}

/** Subset of `types.Knowledge` this host reads back (internal/types/knowledge.go:124-195). */
export type KnowledgeRow = {
  id: string;
  /** pending | processing | finalizing | completed | failed | deleting | cancelled | draft */
  parseStatus: string;
  title: string;
};

export function parseKnowledge(body: unknown): KnowledgeRow | null {
  const data = unwrapEnvelope(body);
  if (!isRecord(data)) {
    return null;
  }
  const id = str(data.id);
  if (!id) {
    return null;
  }
  return { id, parseStatus: str(data.parse_status) ?? "", title: str(data.title) ?? "" };
}

/**
 * One hit from `POST /api/v1/knowledge-bases/:id/hybrid-search` (internal/types/search.go:151).
 *
 * `match_type` is an integer iota upstream, not a string, and is deliberately not read here: what
 * a chunk matched on does not change what it says. `knowledge_custom_metadata` is the *rendered*
 * form of the document's custom metadata — `key: value` lines, keys sorted, joined by newlines
 * (`Knowledge.CustomMetadataText`) — which is what carries our own source identity back.
 */
export type SearchHit = {
  id: string;
  content: string;
  knowledgeId: string;
  chunkIndex: number;
  score: number;
  knowledgeTitle: string;
  customMetadataText: string;
};

/**
 * Caps on what one search may hand back.
 *
 * The request asks for `match_count` hits of ordinary chunk size; the answer is a third party's and
 * is under no obligation to respect either. Both caps sit far above anything a real answer reaches,
 * so they change nothing in normal use and bound the prompt an answer can be turned into.
 */
export const MAX_HITS = 50;
export const MAX_HIT_BODY_CHARS = 8_000;

export function parseSearchResults(body: unknown): SearchHit[] | null {
  const data = unwrapEnvelope(body);
  if (!Array.isArray(data)) {
    return null;
  }
  const hits: SearchHit[] = [];
  for (const entry of data.slice(0, MAX_HITS)) {
    const hit = parseSearchHit(entry);
    if (!hit) {
      return null;
    }
    hits.push(hit);
  }
  return hits;
}

function parseSearchHit(entry: unknown): SearchHit | null {
  if (!isRecord(entry)) {
    return null;
  }
  const content = str(entry.content);
  const knowledgeId = str(entry.knowledge_id);
  if (content === null || knowledgeId === null) {
    return null;
  }
  return {
    id: str(entry.id) ?? "",
    content: content.slice(0, MAX_HIT_BODY_CHARS),
    knowledgeId,
    // A missing index is 0, not a reason to reject: upstream omits nothing here, but a chunk with
    // no position is still a real answer and `mapper.ts` clamps it.
    chunkIndex: num(entry.chunk_index) ?? 0,
    score: num(entry.score) ?? 0,
    knowledgeTitle: str(entry.knowledge_title) ?? "",
    customMetadataText: str(entry.knowledge_custom_metadata) ?? "",
  };
}

/** The metadata we stamp on every document we ingest. Read back through `CustomMetadataText`. */
export type WeKnoraCustomMetadata = {
  workspace_id: string;
  source_id: string;
  origin_kind: string;
  origin_id: string;
  external_ref: string;
};
