import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

function uuidPk(name = "id") {
  return text(name)
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
}

function createdAt(name = "created_at") {
  return integer(name, { mode: "timestamp_ms" as const })
    .notNull()
    .$defaultFn(() => new Date());
}

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * The whitelabel partner, from the portal (docs/internal/portal/schema.md:54-60), and the root of
 * every tenancy scope. One row per portal `tenants.id`. The desktop and any database migrated from
 * before Phase 3 hold exactly the `LOCAL_TENANT_ID` row, written by drizzle/0015_tenants.sql.
 */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** active | inactive — drives the portal's `tenant_inactive` reason code. */
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const organizations = sqliteTable(
  "organizations",
  {
    id: uuidPk(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Unique per tenant, not globally: two tenants both having a "personal" org is normal.
    slug: text("slug").notNull(),
    industryPack: text("industry_pack").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("organizations_tenant_slug").on(table.tenantId, table.slug),
    index("organizations_tenant_idx").on(table.tenantId),
  ],
);

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user").on(table.organizationId, table.userId),
    index("organization_members_org_idx").on(table.organizationId),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    templatePack: text("template_pack"),
    productModes: text("product_modes", { mode: "json" }).$type<string[] | null>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("workspaces_org_slug").on(table.organizationId, table.slug),
    index("workspaces_org_idx").on(table.organizationId),
  ],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: uuidPk(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_members_ws_user").on(table.workspaceId, table.userId),
    index("workspace_members_org_idx").on(table.organizationId),
  ],
);

export const agents = sqliteTable(
  "agents",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").notNull().default("private"),
    createdByUserId: text("created_by_user_id").notNull(),
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("agents_org_ws_idx").on(table.organizationId, table.workspaceId)],
);

export const agentVersions = sqliteTable(
  "agent_versions",
  {
    id: uuidPk(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    model: text("model").notNull(),
    inputModalities: text("input_modalities", { mode: "json" }).$type<string[]>().notNull(),
    productModes: text("product_modes", { mode: "json" }).$type<string[] | null>(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index("agent_versions_org_agent_idx").on(table.organizationId, table.agentId)],
);

export const tools = sqliteTable(
  "tools",
  {
    id: uuidPk(),
    organizationId: text("organization_id"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    jsonSchema: text("json_schema", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    handlerKey: text("handler_key").notNull(),
  },
  (table) => [index("tools_org_idx").on(table.organizationId), uniqueIndex("tools_key_unique").on(table.key)],
);

export const agentToolBindings = sqliteTable(
  "agent_tool_bindings",
  {
    id: uuidPk(),
    agentVersionId: text("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("agent_tool_bindings_org_idx").on(table.organizationId, table.agentVersionId)],
);

export const threads = sqliteTable(
  "threads",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New thread"),
    createdAt: createdAt(),
  },
  (table) => [index("threads_org_user_idx").on(table.organizationId, table.userId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("messages_org_thread_idx").on(table.organizationId, table.threadId)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    agentVersionId: text("agent_version_id")
      .notNull()
      .references(() => agentVersions.id),
    modality: text("modality").notNull(),
    status: text("status").notNull(),
    usage: text("usage", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("runs_org_thread_idx").on(table.organizationId, table.threadId)],
);

export const toolInvocations = sqliteTable(
  "tool_invocations",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    input: text("input", { mode: "json" }).$type<unknown>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    status: text("status").notNull(),
  },
  (table) => [index("tool_invocations_org_run_idx").on(table.organizationId, table.runId)],
);

export const knowledgeSoul = sqliteTable("knowledge_soul", {
  workspaceId: text("workspace_id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  voice: text("voice").notNull(),
  rules: text("rules").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const knowledgeMemories = sqliteTable(
  "knowledge_memories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    text: text("text").notNull(),
    pinned: integer("pinned").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("knowledge_memories_ws_idx").on(table.workspaceId)],
);

export const knowledgeSources = sqliteTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    chunks: integer("chunks").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    /** Work that produced this source (thread / media / artifact); null for File, URL, Paste. */
    originKind: text("origin_kind"),
    originId: text("origin_id"),
    /**
     * The retrieval backend's own handle on this source (a WeKnora `knowledge_id`), or null when
     * the backend holds nothing for it. Derived state: losing it costs a re-index, never a card.
     */
    externalId: text("external_id"),
  },
  (table) => [
    index("knowledge_sources_ws_idx").on(table.workspaceId),
    uniqueIndex("knowledge_sources_origin_idx").on(table.workspaceId, table.originKind, table.originId),
    index("knowledge_sources_external_idx").on(table.workspaceId, table.externalId),
  ],
);

/**
 * Which backend owns a workspace's vectors, and the handles it answers under. One row per desk:
 * one WeKnora knowledge base per agentforge workspace, bound to one backend-side model row.
 */
export const knowledgeWorkspaceBackend = sqliteTable("knowledge_workspace_backend", {
  workspaceId: text("workspace_id").primaryKey(),
  backendId: text("backend_id").notNull(),
  /** Backend-side knowledge base id. */
  kbId: text("kb_id"),
  /** Backend-side embedding model row id. */
  modelId: text("model_id"),
  /** Our embedding model id the row was created for; a change forces an explicit re-index. */
  embeddingModel: text("embedding_model"),
  /** The gateway base URL the backend-side model row was created against. */
  gatewayBaseUrl: text("gateway_base_url"),
  /** sha256 of the gateway key that model row holds, so a key change is detectable without it. */
  gatewayKeyFp: text("gateway_key_fp"),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Writes the retrieval backend could not accept (it was down, or degraded). Drained on the next
 * health-OK transition and on `GET /api/v1/knowledge`, so the Saved -> Indexed edge of the loop
 * survives a dead sidecar instead of silently dropping an ingest or a delete.
 */
export const knowledgeBackendOutbox = sqliteTable(
  "knowledge_backend_outbox",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    /** index | delete */
    op: text("op").notNull(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id"),
    /** JSON detail for an `index` op (the embedding model it was queued for). Never prompt surface. */
    payload: text("payload"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("knowledge_backend_outbox_ws_idx").on(table.workspaceId, table.createdAt)],
);

export const knowledgeSettings = sqliteTable("knowledge_settings", {
  workspaceId: text("workspace_id").primaryKey(),
  embeddingModel: text("embedding_model").notNull(),
  brainModel: text("brain_model").notNull(),
  verifierModel: text("verifier_model").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const knowledgeVectors = sqliteTable(
  "knowledge_vectors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sourceId: text("source_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    body: text("body").notNull(),
    embedding: text("embedding").notNull(),
    model: text("model").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("knowledge_vectors_ws_source_idx").on(table.workspaceId, table.sourceId),
    // Retrieval asks "which model's rows does this workspace hold, and give me them": both halves
    // are (workspace_id, model), and both scanned the table until 0012 (see drizzle/0012).
    index("knowledge_vectors_ws_model_idx").on(table.workspaceId, table.model),
  ],
);

/**
 * One row per chunk a run was actually given: the measured "Retrieved" edge of the knowledge loop
 * and the first retrieval graph edge (source -> thread). `backend` records which engine served it.
 * Written by `recordRetrievals`; never on the critical path of a run (see drizzle/0010).
 */
export const knowledgeRetrievals = sqliteTable(
  "knowledge_retrievals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    threadId: text("thread_id"),
    runId: text("run_id"),
    sourceId: text("source_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    /**
     * Since Phase 2 this is the *fused* RRF score of the chunk (see knowledge/backends/builtin.ts),
     * normalized into (0, 1] within one query. Rows written before Phase 2 hold a raw bm25-derived
     * or cosine score instead, so values are not comparable across that boundary — aggregate them
     * per period, never as one all-time average.
     */
    score: real("score").notNull(),
    backend: text("backend").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("knowledge_retrievals_ws_created_idx").on(table.workspaceId, table.createdAt),
    index("knowledge_retrievals_ws_source_idx").on(table.workspaceId, table.sourceId),
  ],
);

/**
 * Graph stage of the knowledge loop. A node is a `topic` (from the knowledge map), a `source`
 * (a `knowledge_sources` row) or a `thread`. Ids are globally unique so an edge needs no kind.
 */
export const knowledgeGraphNodes = sqliteTable(
  "knowledge_graph_nodes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    /** topic | source | thread */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    /** Optional JSON detail (topic verdict, source type). Never prompt surface. */
    payload: text("payload"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("knowledge_graph_nodes_ws_kind_idx").on(table.workspaceId, table.kind)],
);

/**
 * Edges are aggregated, not appended: one row per `(workspace, from, to, kind)` whose `weight` is
 * the count (or strength) behind it, which is what keeps the table from growing per retrieval event.
 */
export const knowledgeGraphEdges = sqliteTable(
  "knowledge_graph_edges",
  {
    workspaceId: text("workspace_id").notNull(),
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    /** covers | retrieved | cites */
    kind: text("kind").notNull(),
    weight: real("weight").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.fromId, table.toId, table.kind] }),
    index("knowledge_graph_edges_ws_kind_idx").on(table.workspaceId, table.kind),
  ],
);

/** Last planted-fact self-check for a workspace: the Verified stage of the loop chart. */
export const knowledgeVerify = sqliteTable("knowledge_verify", {
  workspaceId: text("workspace_id").primaryKey(),
  ok: integer("ok").notNull(),
  detail: text("detail").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const knowledgeMaps = sqliteTable("knowledge_maps", {
  workspaceId: text("workspace_id").primaryKey(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export const media = sqliteTable(
  "media",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    url: text("url").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("media_org_idx").on(table.organizationId)],
);

export const editProjects = sqliteTable(
  "edit_projects",
  {
    id: uuidPk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fps: integer("fps").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    seq: integer("seq").notNull().default(0),
    reviewJson: text("review_json", { mode: "json" }).$type<{ lastAgentSeq: number; ackSeq: number }>().notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("edit_projects_org_ws_idx").on(table.organizationId, table.workspaceId)],
);

export const editOps = sqliteTable(
  "edit_ops",
  {
    id: uuidPk(),
    projectId: text("project_id")
      .notNull()
      .references(() => editProjects.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    parent: text("parent"),
    clock: integer("clock").notNull(),
    actor: text("actor").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<unknown>().notNull(),
    inverseJson: text("inverse_json", { mode: "json" }).$type<unknown>(),
    cardId: text("card_id"),
    undoOf: text("undo_of"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("edit_ops_project_seq").on(table.projectId, table.seq)],
);

export const editSnapshots = sqliteTable(
  "edit_snapshots",
  {
    id: uuidPk(),
    projectId: text("project_id")
      .notNull()
      .references(() => editProjects.id, { onDelete: "cascade" }),
    upToSeq: integer("up_to_seq").notNull(),
    docJson: text("doc_json", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("edit_snapshots_project_seq_idx").on(table.projectId, table.upToSeq)],
);

export const editJobs = sqliteTable(
  "edit_jobs",
  {
    id: uuidPk(),
    projectId: text("project_id")
      .notNull()
      .references(() => editProjects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    targetClipIdsJson: text("target_clip_ids_json", { mode: "json" }).$type<string[]>().notNull(),
    cardId: text("card_id"),
    requestJson: text("request_json", { mode: "json" }).$type<unknown>().notNull(),
    model: text("model"),
    tier: text("tier"),
    estimateUsd: real("estimate_usd"),
    actualUsd: real("actual_usd"),
    progress: real("progress").notNull().default(0),
    outputAssetIdsJson: text("output_asset_ids_json", { mode: "json" }).$type<string[]>(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("edit_jobs_project_status_idx").on(table.projectId, table.status)],
);

export const editCards = sqliteTable(
  "edit_cards",
  {
    id: uuidPk(),
    projectId: text("project_id")
      .notNull()
      .references(() => editProjects.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    toolKey: text("tool_key").notNull(),
    verb: text("verb").notNull(),
    object: text("object").notNull(),
    opIdsJson: text("op_ids_json", { mode: "json" }).$type<string[]>().notNull(),
    jobId: text("job_id"),
    status: text("status").notNull(),
    thumbsJson: text("thumbs_json", { mode: "json" }).$type<string[]>().notNull(),
    estimateUsd: real("estimate_usd"),
    tier: text("tier"),
    createdAt: createdAt(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("edit_cards_project_status_idx").on(table.projectId, table.status)],
);

export const editUnplaced = sqliteTable(
  "edit_unplaced",
  {
    id: uuidPk(),
    projectId: text("project_id")
      .notNull()
      .references(() => editProjects.id, { onDelete: "cascade" }),
    jobId: text("job_id").notNull(),
    assetId: text("asset_id").notNull(),
    prompt: text("prompt"),
    createdAt: createdAt(),
    placedClipId: text("placed_clip_id"),
    discardedAt: integer("discarded_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("edit_unplaced_project_idx").on(table.projectId)],
);

/** Kernel-neutral job outputs (research dossiers, data analyses, finance briefs, drafts). Body is sealed at rest. */
export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    mode: text("mode").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    mime: text("mime").notNull(),
    body: text("body").notNull(),
    meta: text("meta").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("artifacts_ws_mode_idx").on(table.workspaceId, table.mode, table.createdAt)],
);

/** Uploaded tables for the Data / Finance analyst modes. Raw file lives under localDataDir()/datasets. */
export const datasets = sqliteTable(
  "datasets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    filename: text("filename").notNull(),
    rows: integer("rows").notNull(),
    cols: integer("cols").notNull(),
    columns: text("columns").notNull(),
    storagePath: text("storage_path").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("datasets_ws_idx").on(table.workspaceId, table.createdAt)],
);

/**
 * Market mode read-through cache: one row per (ticker, kind) holding the latest
 * fetched payload (JSON) and its SourceRef (JSON). `kind` is one of
 * fundamentals | prices | analysts | news. The companion FTS5 table
 * `market_news_fts(ticker, title, summary, link UNINDEXED, published_at UNINDEXED)`
 * is SQL-only (drizzle/0009_market.sql), like knowledge_chunks.
 */
export const marketCache = sqliteTable(
  "market_cache",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    sourceRef: text("source_ref").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [index("market_cache_ticker_kind_idx").on(table.ticker, table.kind, table.observedAt)],
);

/**
 * Browser sessions for the hosted deployment (docs/internal/web-migration-plan.md, Phase 2;
 * docs/internal/web-security-spec.md row T1). The cookie carries `id` and nothing else; every
 * attribute lives here. Idle timeout 12 h (`expires_at`, slid at most once per 5 min) and absolute
 * 30 days (`absolute_expires_at`); sign-out sets `revoked_at` rather than deleting the row, so a
 * revoked session reports itself instead of looking like a stranger.
 *
 * Desktop and webdev never write this table: they have no session at all.
 */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    orgId: text("org_id").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    absoluteExpiresAt: integer("absolute_expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    // The Phase 5 seat counter reads "members with a live session in the last 30 days" off this.
    index("auth_sessions_user_seen_idx").on(table.userId, table.lastSeenAt),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);
