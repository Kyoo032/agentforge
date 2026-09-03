import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const organizations = sqliteTable("organizations", {
  id: uuidPk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industryPack: text("industry_pack").notNull(),
  createdAt: createdAt(),
});

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
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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
  },
  (table) => [index("knowledge_sources_ws_idx").on(table.workspaceId)],
);

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
