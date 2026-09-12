import { ApiError, knowledgeBackendSetting, type TenantContext } from "@agentforge/core";
import type { KnowledgeBackendId } from "./backend";
import { knowledgeBackendState, putSelectedBackendId } from "./registry";

/** Builtin-only picture for GET /api/v1/knowledge. Sidecar switch is gone. */

export type KnowledgeBackendPayload = {
  id: KnowledgeBackendId;
  selected: KnowledgeBackendId;
  available: boolean;
  reason: string | null;
  health: { ok: boolean; detail?: string } | null;
  outbox: number;
};

export async function backendPayload(_tenant: TenantContext): Promise<KnowledgeBackendPayload> {
  const state = knowledgeBackendState();
  return {
    id: state.id,
    selected: state.selected,
    available: true,
    reason: null,
    health: { ok: true },
    outbox: 0,
  };
}

export async function revokeKnowledgeGatewayModel(_tenant: TenantContext): Promise<void> {
  // Sidecar model rows no longer exist.
}

export function parseBackendId(body: unknown): KnowledgeBackendId {
  const raw = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
  const id = knowledgeBackendSetting(raw);
  if (!id) {
    throw new ApiError("invalid_request", 'id must be "builtin"', 400);
  }
  if (id === "weknora") {
    throw new ApiError("invalid_request", "WeKnora sidecar is not part of this product", 400);
  }
  return id;
}

export async function selectKnowledgeBackend(
  tenant: TenantContext,
  id: KnowledgeBackendId,
): Promise<KnowledgeBackendPayload> {
  if (id !== "builtin") {
    throw new ApiError("invalid_request", "WeKnora sidecar is not part of this product", 400);
  }
  putSelectedBackendId("builtin");
  return backendPayload(tenant);
}
