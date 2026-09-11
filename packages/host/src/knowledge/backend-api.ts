import { ApiError, knowledgeBackendSetting, type TenantContext } from "@agentforge/core";
import type { BackendHealth, KnowledgeBackendId } from "./backend";
import { getWorkspaceBinding } from "./backend-store";
import { gatewayFor } from "./backends/weknora/bootstrap";
import { weknoraAvailable } from "./backends/weknora/binary";
import { sidecarStatus } from "./backends/weknora/supervisor";
import { backfillPending } from "./backfill";
import { outboxDepth } from "./outbox";
import { drainKnowledgeOutbox, knowledgeBackendState, putSelectedBackendId, weknoraBackend } from "./registry";

/**
 * The `backend` object on `GET /api/v1/knowledge` and the endpoint that changes it.
 *
 * This is the whole contract the Knowledge page sees: which engine is selected, which one is
 * actually answering, whether the sidecar is even installed, and how much the backend still owes.
 * Keeping it in one module means the page's contract and the fallback rules cannot drift apart.
 */

/** How long a flag flip may block on first-run bootstrap before it answers anyway. */
export const BOOTSTRAP_CAP_MS = 30_000;

export type KnowledgeBackendPayload = {
  id: KnowledgeBackendId;
  selected: KnowledgeBackendId;
  available: boolean;
  reason: string | null;
  health: BackendHealth | null;
  /** Writes the backend still owes, plus sources it has never been given. */
  outbox: number;
};

/**
 * The current backend picture.
 *
 * Health is probed only when the sidecar is already up (or the caller explicitly asks): the page
 * load that renders this must not be the thing that pays a cold start, and `null` is an honest
 * answer for "nothing has needed it yet".
 */
export async function backendPayload(
  tenant: TenantContext,
  options: { probe?: boolean } = {},
): Promise<KnowledgeBackendPayload> {
  const state = knowledgeBackendState();
  const binary = weknoraAvailable();
  const pending = outboxDepth(tenant) + (state.selected === "weknora" ? backfillPending(tenant) : 0);
  return {
    id: state.id,
    selected: state.selected,
    // `available` answers "can this desk pick WeKnora", not "is WeKnora answering" — that is `id`.
    // It is the question the Knowledge page's card asks before it offers the switch at all, so it
    // has to be true of the machine rather than of the current selection: a desk on the built-in
    // backend that reports `available: true` offers a switch that immediately 409s.
    available: binary.available,
    // The binary's own reason first (`not_staged`, `unsupported_platform`), then whatever the
    // registry has to add — the degraded reason, which only exists once the binary is there.
    reason: binary.reason ?? state.reason,
    health: await healthFor(state.selected, options.probe === true),
    outbox: pending,
  };
}

async function healthFor(selected: KnowledgeBackendId, probe: boolean): Promise<BackendHealth | null> {
  if (selected !== "weknora") {
    return null;
  }
  if (!probe && !sidecarStatus().running) {
    return null;
  }
  return weknoraBackend().health();
}

/**
 * Delete the backend-side model row holding this desk's gateway key.
 *
 * Two callers, one rule: a key that has been rotated (or a backend that has been switched off) must
 * not stay usable inside the sidecar's own database. `force` is the deselect path, which revokes
 * unconditionally; the settings-save path revokes only when the credentials the row was minted from
 * no longer match what the desk is configured with, so saving an unrelated preference does not
 * churn the model row on every request.
 *
 * Never throws and never blocks the caller's real work: an unreachable sidecar leaves the deletion
 * queued in the `__weknora__` settings slice, to be applied on the next connection.
 */
export async function revokeKnowledgeGatewayModel(
  tenant: TenantContext,
  options: { force?: boolean } = {},
): Promise<void> {
  try {
    const binding = getWorkspaceBinding(tenant, "weknora");
    if (!binding?.modelId) {
      return;
    }
    if (!options.force) {
      const gateway = gatewayFor(tenant);
      if (binding.gatewayBaseUrl === gateway.baseUrl && binding.gatewayKeyFp === gateway.fingerprint) {
        return;
      }
    }
    await weknoraBackend().revokeGatewayModel(tenant);
  } catch (error) {
    console.warn(
      `knowledge-backend: gateway model not revoked (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
  }
}

/** Parse the `{id}` body of `PUT /api/v1/knowledge/backend`. */
export function parseBackendId(body: unknown): KnowledgeBackendId {
  const raw = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
  const id = knowledgeBackendSetting(raw);
  if (!id) {
    throw new ApiError("invalid_request", 'id must be "builtin" or "weknora"', 400);
  }
  return id;
}

/**
 * Answer after `capMs` at the latest, with `fallback`.
 *
 * The work is *not* cancelled — `prepare` is a multi-step bootstrap (auto-setup, key, model row,
 * knowledge base) with no abort seam, and cancelling it halfway would leave the sidecar holding
 * half a tenant. It keeps running to completion in the background, writing whatever it creates; the
 * cap only bounds how long the owner's click waits before the page reports what it knows so far.
 */
function withCap<T>(work: Promise<T>, capMs: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), capMs).unref?.();
    }),
  ]);
}

/**
 * Select a backend.
 *
 * Selecting WeKnora when the sidecar is not installed is a 409 rather than a stored-but-useless
 * setting: the desk would look switched while nothing changed. When it *is* installed the flip runs
 * first-run bootstrap synchronously (capped), because the owner clicked a button and deserves to
 * find out now whether it worked — but a slow or failed bootstrap still leaves the flag set, with
 * `health.ok = false`, so the degraded path takes over instead of the switch silently reverting.
 */
export async function selectKnowledgeBackend(
  tenant: TenantContext,
  id: KnowledgeBackendId,
): Promise<KnowledgeBackendPayload> {
  if (id === "weknora") {
    const binary = weknoraAvailable();
    if (!binary.available) {
      throw new ApiError(
        "backend_unavailable",
        `The WeKnora sidecar is not available on this machine (${binary.reason ?? "not_staged"}).`,
        409,
      );
    }
  }
  putSelectedBackendId(id);
  if (id !== "weknora") {
    // Deselecting is where the gateway key comes back out of the sidecar's database.
    await revokeKnowledgeGatewayModel(tenant, { force: true });
    return backendPayload(tenant);
  }
  const health = await withCap(weknoraBackend().prepare(tenant), BOOTSTRAP_CAP_MS, {
    ok: false,
    detail: "bootstrap still running",
  });
  if (health.ok) {
    void drainKnowledgeOutbox(tenant);
  }
  return { ...(await backendPayload(tenant)), health };
}
