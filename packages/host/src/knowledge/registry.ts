import type { TenantContext } from "@agentforge/core";
import {
  type BackendRetrieveOptions,
  type BackendSource,
  type KnowledgeBackend,
  type KnowledgeBackendId,
  type RetrieveResult,
} from "./backend";
import { SqliteBuiltinBackend } from "./backends/builtin";

/**
 * Builtin-only registry. WeKnora-class retrieval lives in SqliteBuiltinBackend.
 * A leftover `knowledgeBackend: weknora` in settings is ignored.
 */

let builtin: SqliteBuiltinBackend | null = null;

export function builtinBackend(): SqliteBuiltinBackend {
  builtin ??= new SqliteBuiltinBackend();
  return builtin;
}

export function resetBackendHealthForTests(): void {
  // Kept so older tests that reset sidecar health still compile after the strip.
}

export function selectedBackendId(): KnowledgeBackendId {
  return "builtin";
}

export function putSelectedBackendId(_id: KnowledgeBackendId): KnowledgeBackendId {
  return "builtin";
}

export type BackendState = {
  id: KnowledgeBackendId;
  selected: KnowledgeBackendId;
  available: boolean;
  reason: string | null;
  degraded: boolean;
};

export function knowledgeBackendState(): BackendState {
  return { id: "builtin", selected: "builtin", available: true, reason: null, degraded: false };
}

export function getKnowledgeBackend(): KnowledgeBackend {
  return builtinBackend();
}

export async function retrieveThroughBackend(
  tenant: TenantContext,
  query: string,
  opts: BackendRetrieveOptions,
): Promise<RetrieveResult> {
  return builtinBackend().retrieve(tenant, query, opts);
}

export async function indexThroughBackend(
  tenant: TenantContext,
  source: BackendSource,
  chunks: string[],
  model: string,
): Promise<void> {
  await builtinBackend().indexSource(tenant, source, chunks, model);
}

export async function deleteThroughBackend(
  tenant: TenantContext,
  sourceId: string,
  _externalId?: string | null,
): Promise<void> {
  await builtinBackend().deleteSource(tenant, sourceId);
}
