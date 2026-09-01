import { and, asc, desc, eq, ne } from "drizzle-orm";
import { agents, db, messages, runs, threads, toolInvocations } from "@agentforge/db";
import type { ContentPart, InputModality, TenantContext } from "@agentforge/core";
import { ApiError, DEFAULT_CHAT_SLUG, isDefaultChatAgent, openPayload, sealPayload } from "@agentforge/core";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { DEFAULT_THREAD_TITLE, titleFromParts } from "./thread-title";
import { messageText } from "./message-text";

const PREVIEW_MAX = 80;
const READ_MESSAGE_MAX = 2_000;
const READ_TRANSCRIPT_MAX = 12_000;

function sealJson(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  return sealPayload(value, getLocalVaultKey());
}

function openJson(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  return openPayload(value, getLocalVaultKey());
}

export async function createThread(tenant: TenantContext, agentId: string, title?: string) {
  const [row] = await db
    .insert(threads)
    .values({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      agentId,
      userId: tenant.userId,
      title: title ?? DEFAULT_THREAD_TITLE,
    })
    .returning();
  return row;
}

export async function getThread(tenant: TenantContext, threadId: string) {
  const rows = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.organizationId, tenant.organizationId),
        eq(threads.userId, tenant.userId),
        eq(threads.id, threadId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listThreads(tenant: TenantContext, agentId: string) {
  return db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.organizationId, tenant.organizationId),
        eq(threads.agentId, agentId),
        eq(threads.userId, tenant.userId),
      ),
    )
    .orderBy(desc(threads.createdAt));
}

export type WorkspaceThreadScope = "chat" | "agent" | "all";

export async function listWorkspaceThreads(
  tenant: TenantContext,
  options: {
    limit?: number;
    scope?: WorkspaceThreadScope;
    agentId?: string;
  } = {},
) {
  const limit = options.limit ?? 40;
  const scope = options.scope ?? "all";
  const conditions = [
    eq(threads.organizationId, tenant.organizationId),
    eq(threads.workspaceId, tenant.workspaceId),
    eq(threads.userId, tenant.userId),
  ];
  if (scope === "agent" && options.agentId) {
    conditions.push(eq(threads.agentId, options.agentId));
  } else if (scope === "chat") {
    conditions.push(eq(agents.slug, DEFAULT_CHAT_SLUG));
  }

  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      agentId: threads.agentId,
      createdAt: threads.createdAt,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(threads)
    .innerJoin(agents, eq(agents.id, threads.agentId))
    .where(and(...conditions))
    .orderBy(desc(threads.createdAt))
    .limit(limit);

  if (scope === "agent" && !options.agentId) {
    return rows.filter((row) => !isDefaultChatAgent({ slug: row.agentSlug }));
  }
  return rows;
}

export async function deleteThread(tenant: TenantContext, threadId: string): Promise<boolean> {
  const thread = await getThread(tenant, threadId);
  if (!thread) {
    return false;
  }
  await db
    .delete(threads)
    .where(
      and(
        eq(threads.organizationId, tenant.organizationId),
        eq(threads.userId, tenant.userId),
        eq(threads.id, threadId),
      ),
    );
  return true;
}

export type PastSessionSummary = {
  id: string;
  title: string;
  createdAt: Date;
  preview: string | null;
};

export async function listPastSessionsForAgent(
  tenant: TenantContext,
  agentId: string,
  excludeThreadId: string,
  limit = 12,
): Promise<PastSessionSummary[]> {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      createdAt: threads.createdAt,
    })
    .from(threads)
    .where(
      and(
        eq(threads.organizationId, tenant.organizationId),
        eq(threads.agentId, agentId),
        eq(threads.userId, tenant.userId),
        ne(threads.id, excludeThreadId),
        ne(threads.title, DEFAULT_THREAD_TITLE),
      ),
    )
    .orderBy(desc(threads.createdAt))
    .limit(limit);

  const summaries: PastSessionSummary[] = [];
  for (const row of rows) {
    const [firstUser] = await db
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, tenant.organizationId),
          eq(messages.threadId, row.id),
          eq(messages.role, "user"),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(1);
    const opened = firstUser ? openJson(firstUser.content) : null;
    const previewSource = opened ? (titleFromParts(opened) ?? messageText(opened)) : null;
    const preview =
      previewSource && previewSource.length > PREVIEW_MAX
        ? `${previewSource.slice(0, PREVIEW_MAX - 1).trimEnd()}…`
        : previewSource;
    summaries.push({ ...row, preview });
  }
  return summaries;
}

export async function readPastSessionMessages(
  tenant: TenantContext,
  agentId: string,
  sessionId: string,
): Promise<{ title: string; messages: Array<{ role: string; text: string }> } | null> {
  const thread = await getThread(tenant, sessionId);
  if (!thread || thread.agentId !== agentId) {
    return null;
  }
  const rows = await listMessages(tenant, sessionId);
  const transcript: Array<{ role: string; text: string }> = [];
  let totalChars = 0;
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") {
      continue;
    }
    const text = messageText(row.content);
    if (!text) {
      continue;
    }
    const clipped =
      text.length > READ_MESSAGE_MAX ? `${text.slice(0, READ_MESSAGE_MAX - 1).trimEnd()}…` : text;
    if (totalChars + clipped.length > READ_TRANSCRIPT_MAX) {
      break;
    }
    totalChars += clipped.length;
    transcript.push({ role: row.role, text: clipped });
  }
  return { title: thread.title, messages: transcript };
}

export async function setThreadTitleFromParts(tenant: TenantContext, threadId: string, parts: unknown) {
  const title = titleFromParts(parts);
  if (!title) {
    return;
  }
  const thread = await getThread(tenant, threadId);
  if (!thread || thread.title !== DEFAULT_THREAD_TITLE) {
    return;
  }
  await db
    .update(threads)
    .set({ title })
    .where(and(eq(threads.organizationId, tenant.organizationId), eq(threads.id, threadId)));
}

export async function listMessages(tenant: TenantContext, threadId: string) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, tenant.organizationId), eq(messages.threadId, threadId)))
    .orderBy(asc(messages.createdAt));
  return rows.map((row) => ({ ...row, content: openJson(row.content) }));
}

export async function insertMessage(
  tenant: TenantContext,
  threadId: string,
  role: "user" | "assistant",
  content: ContentPart[],
) {
  const [row] = await db
    .insert(messages)
    .values({
      organizationId: tenant.organizationId,
      threadId,
      role,
      content: sealJson(content),
    })
    .returning();
  if (!row) {
    return row;
  }
  return { ...row, content: openJson(row.content) };
}

export async function insertRun(
  tenant: TenantContext,
  threadId: string,
  agentVersionId: string,
  modality: InputModality,
) {
  const [row] = await db
    .insert(runs)
    .values({
      organizationId: tenant.organizationId,
      threadId,
      agentVersionId,
      modality,
      status: "streaming",
    })
    .returning();
  return row;
}

export async function finishRun(
  tenant: TenantContext,
  runId: string,
  status: "completed" | "failed",
  error?: string,
  usage?: Record<string, unknown> | null,
) {
  await db
    .update(runs)
    .set({
      status,
      error: error ?? null,
      finishedAt: new Date(),
      ...(usage ? { usage } : {}),
    })
    .where(and(eq(runs.organizationId, tenant.organizationId), eq(runs.id, runId)));
}

export async function listRunUsage(tenant: TenantContext) {
  return db
    .select({ usage: runs.usage })
    .from(runs)
    .where(eq(runs.organizationId, tenant.organizationId));
}

export async function insertToolInvocation(
  tenant: TenantContext,
  runId: string,
  toolKey: string,
  input: unknown,
  output: unknown,
  status: string,
) {
  await db.insert(toolInvocations).values({
    organizationId: tenant.organizationId,
    runId,
    toolKey,
    input: sealJson(input),
    output: sealJson(output),
    status,
  });
}

export function requireThread(thread: unknown, message = "Thread not found") {
  if (!thread) {
    throw new ApiError("not_found", message, 404);
  }
  return thread;
}
