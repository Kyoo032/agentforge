import { db, DrizzleAgentRepository, ensureLocalOwner, listLocalWorkspaces } from "@agentforge/db";
import { AgentService, HOME_WORKSPACE_SLUG, type TenantContext } from "@agentforge/core";
import { readSelectedWorkspaceId, writeSelectedWorkspaceId } from "./workspace";
import { adoptLegacySettings } from "./settings-store";

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
 */
function rememberSelectedWorkspace(workspaceId: string): void {
  try {
    writeSelectedWorkspaceId(workspaceId);
  } catch (error) {
    console.warn("[agentforge] Could not record the selected desk.", error instanceof Error ? error.message : error);
  }
}

export async function getTenant(preferredWorkspaceId?: string | null): Promise<TenantContext> {
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
