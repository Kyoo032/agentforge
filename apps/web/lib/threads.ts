import { and, asc, desc, eq } from "drizzle-orm";
import { agents, db, messages, runs, threads, toolInvocations } from "@agentforge/db";
import type { ContentPart, InputModality, TenantContext } from "@agentforge/core";
import { ApiError, openPayload, sealPayload } from "@agentforge/core";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { DEFAULT_THREAD_TITLE, titleFromParts } from "./thread-title";

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

export async function listWorkspaceThreads(tenant: TenantContext, limit = 40) {
  return db
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
    .where(
      and(
        eq(threads.organizationId, tenant.organizationId),
        eq(threads.workspaceId, tenant.workspaceId),
        eq(threads.userId, tenant.userId),
      ),
    )
    .orderBy(desc(threads.createdAt))
    .limit(limit);
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

export async function finishRun(tenant: TenantContext, runId: string, status: "completed" | "failed", error?: string) {
  await db
    .update(runs)
    .set({ status, error: error ?? null, finishedAt: new Date() })
    .where(and(eq(runs.organizationId, tenant.organizationId), eq(runs.id, runId)));
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
