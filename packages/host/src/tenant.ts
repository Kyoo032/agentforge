import {
  db,
  DrizzleAgentRepository,
  ensureLocalOwner,
  listLocalWorkspaces,
  resolvePortalTenant,
  type PortalResolveFailure,
} from "@agentforge/db";
import { AgentService, ApiError, HOME_WORKSPACE_SLUG, isServerMode, type TenantContext } from "@agentforge/core";
import { readSelectedWorkspaceId, writeSelectedWorkspaceId } from "./workspace";
import { adoptLegacySettings } from "./settings-store";
import { currentRequestSession } from "./tenant-scope";
import type { HostRequest, HostSession } from "./types";
import { log } from "./log";

export const agentService = new AgentService(new DrizzleAgentRepository(db));

/**
 * A fresh install has no `workspace-id.txt` — only create / select / delete in the workspace
 * handlers ever wrote it — so any settings read that does not name a desk resolves to the
 * empty `__default__` slice and reports "no key" even after onboarding saved one. Stamp the
 * resolved desk on the first request instead.
 *
 * Only ever called for a request that named no desk of its own. A per-request preference (the
 * `WORKSPACE_COOKIE` one tab happens to carry) is that tab's desk, not the machine's: promoting it
 * here would let one tab silently repoint every deskless read for the whole install.
 *
 * Desktop and webdev only: `writeSelectedWorkspaceId` is a no-op in server mode (`./workspace.ts`),
 * where the file is machine-wide and the machine is shared by every tenant.
 */
function rememberSelectedWorkspace(workspaceId: string): void {
  try {
    writeSelectedWorkspaceId(workspaceId);
  } catch (error) {
    log.warn("selected_desk_not_recorded", { detail: error instanceof Error ? error.message : error });
  }
}

/** What a caller may hand `getTenant`: a bare desk id as before, or the request itself. */
export type TenantInput = string | null | undefined | Pick<HostRequest, "workspaceId" | "session">;

/**
 * Each refusal keeps the reason code the auth module already publishes
 * (`./auth/session.ts` `AUTH_REASONS`), so the renderer localises it from the catalog it has.
 * `workspace_not_found` is the one code that is not a sign-in reason: it is a 404 about a desk, and
 * `dispatch` clears the stale workspace cookie when it sees it.
 */
const FAILURE_STATUS: Record<PortalResolveFailure, number> = {
  tenant_inactive: 403,
  org_inactive: 403,
  user_inactive: 403,
  workspace_not_found: 404,
};

const FAILURE_MESSAGE: Record<PortalResolveFailure, string> = {
  tenant_inactive: "Your provider's account is not active. Contact support.",
  org_inactive: "Your organisation is not active.",
  user_inactive: "Your account is disabled.",
  workspace_not_found: "Workspace not found",
};

export function isForeignWorkspaceError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "workspace_not_found";
}

function isRequestLike(input: TenantInput): input is Pick<HostRequest, "workspaceId" | "session"> {
  return typeof input === "object" && input !== null;
}

/**
 * Resolve the tenant of a request.
 *
 * **Desktop and webdev** (`isServerMode()` false) are unchanged in every path: the single local
 * owner, the machine's `workspace-id.txt`, and `pickWorkspaceId`'s silent substitution when the
 * caller names a desk that does not exist.
 *
 * **The hosted server** resolves from the verified session and nothing else — either the one on the
 * request or, until lane E sweeps the 102 call sites, the one `dispatch` put in async-local storage
 * (`./tenant-scope.ts`). The client-supplied `WORKSPACE_COOKIE` is only ever a *preference*, checked
 * against the desks the session's org owns; a desk it does not own is a 404 (spec §3d), never a
 * substitution. **No session resolves to no tenant**: a 401, never a fall back to `local-tenant`.
 * The portal's browser-login grant is undocumented (spec §8 q1), so this is the runtime check that
 * makes an unverified contract fail closed rather than open.
 *
 * Source-compatible on purpose (spec §3c): a `string | null | undefined` behaves as it always did,
 * so every existing call site compiles and keeps working.
 */
export async function getTenant(input?: TenantInput): Promise<TenantContext> {
  const requestLike = isRequestLike(input);
  const preferredWorkspaceId = requestLike ? input.workspaceId : input;
  const session: HostSession | undefined = (requestLike ? input.session : undefined) ?? currentRequestSession();

  if (session) {
    return resolveFromSession(session, preferredWorkspaceId);
  }
  if (isServerMode()) {
    // Fail closed. A hosted request without a session never reaches a handler (the router's gate
    // answers 401 first), so this is the belt to that brace: a background caller, or a route added
    // without the gate, gets a refusal rather than another tenant's desk.
    throw new ApiError("session_required", "Please sign in to continue.", 401);
  }
  return resolveLocalOwner(preferredWorkspaceId);
}

async function resolveFromSession(session: HostSession, preferredWorkspaceId?: string | null): Promise<TenantContext> {
  const resolution = await resolvePortalTenant(
    db,
    { tenantId: session.tenantId, orgId: session.orgId, userId: session.userId },
    preferredWorkspaceId,
  );
  if (!resolution.ok) {
    throw new ApiError(resolution.code, FAILURE_MESSAGE[resolution.code], FAILURE_STATUS[resolution.code]);
  }
  return resolution.tenant;
}

async function resolveLocalOwner(preferredWorkspaceId?: string | null): Promise<TenantContext> {
  const explicit = preferredWorkspaceId?.trim();
  const selected = readSelectedWorkspaceId();
  const tenant = await ensureLocalOwner(db, explicit || selected);
  const rows = await listLocalWorkspaces(db, tenant.organizationId);
  const home = rows.find((row) => row.slug === HOME_WORKSPACE_SLUG) ?? rows[0];
  if (home) {
    adoptLegacySettings(home.id);
  }
  // `selected` is the read from the top of this call: never a second stat of the same file, and
  // never an overwrite of a selection that is already on disk.
  if (!explicit && !selected) {
    rememberSelectedWorkspace(tenant.workspaceId);
  }
  return tenant;
}
