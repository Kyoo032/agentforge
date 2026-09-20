import {
  isWorkspaceTemplateId,
  productModesForTemplate,
  requireProductModes,
  resolveWorkspaceModes,
  HOME_WORKSPACE_SLUG,
} from "@agentforge/core";
import {
  createLocalWorkspace,
  db,
  deleteLocalWorkspace,
  listLocalWorkspaces,
  updateLocalWorkspace,
} from "@agentforge/db";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { dropWorkspaceSettings } from "../settings-store";
import { channelStore } from "../channels/store";
import { getTenant } from "../tenant";
import { writeSelectedWorkspaceId, workspaceCookie } from "../workspace";

function serializeWorkspace(row: {
  id: string;
  name: string;
  slug: string;
  templatePack?: string | null;
  productModes?: string[] | null;
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    templatePack: row.templatePack ?? null,
    productModes: resolveWorkspaceModes(row.productModes),
    protected: row.slug === HOME_WORKSPACE_SLUG,
  };
}

export async function handleGetWorkspaces(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    return jsonOk({
      workspaces: rows.map(serializeWorkspace),
      currentWorkspaceId: tenant.workspaceId,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostWorkspaces(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as { name?: string; templatePack?: string; productModes?: unknown };
    const name = body.name?.trim();
    if (!name) {
      return jsonOk({ error: { code: "invalid", message: "Name is required" } }, 400);
    }
    const templatePack = body.templatePack?.trim();
    if (templatePack && !isWorkspaceTemplateId(templatePack)) {
      return jsonOk({ error: { code: "unknown_template_pack", message: "Unknown workspace template" } }, 400);
    }
    const productModes =
      body.productModes != null
        ? requireProductModes(body.productModes)
        : productModesForTemplate(templatePack || null);
    const workspace = await createLocalWorkspace(
      db,
      tenant.organizationId,
      name,
      templatePack || undefined,
      productModes,
    );
    writeSelectedWorkspaceId(workspace.id);
    return jsonOk(
      { workspace: serializeWorkspace(workspace), seeded: false },
      201,
      [workspaceCookie(workspace.id)],
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleSelectWorkspace(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const workspaceId = request.params.workspaceId;
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    const found = rows.find((row) => row.id === workspaceId);
    if (!found) {
      return jsonOk({ error: { code: "not_found", message: "Workspace not found" } }, 404);
    }
    writeSelectedWorkspaceId(found.id);
    return jsonOk(
      { workspace: { id: found.id, name: found.name, slug: found.slug } },
      200,
      [workspaceCookie(found.id)],
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePatchWorkspace(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const workspaceId = request.params.workspaceId;
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    const found = rows.find((row) => row.id === workspaceId);
    if (!found) {
      return jsonOk({ error: { code: "not_found", message: "Workspace not found" } }, 404);
    }
    const body = (request.body ?? {}) as { name?: string; productModes?: unknown };
    const productModes = body.productModes != null ? requireProductModes(body.productModes) : undefined;
    const updated = await updateLocalWorkspace(db, tenant.organizationId, workspaceId, {
      name: body.name,
      productModes,
    });
    return jsonOk({
      workspace: updated
        ? {
            id: updated.id,
            name: updated.name,
            slug: updated.slug,
            templatePack: updated.templatePack ?? null,
            productModes: resolveWorkspaceModes(updated.productModes),
            protected: updated.slug === HOME_WORKSPACE_SLUG,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteWorkspace(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const workspaceId = request.params.workspaceId;
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    const found = rows.find((row) => row.id === workspaceId);
    if (!found) {
      return jsonOk({ error: { code: "not_found", message: "Workspace not found" } }, 404);
    }
    if (found.slug === HOME_WORKSPACE_SLUG) {
      return jsonOk({ error: { code: "protected", message: "The Default desk cannot be deleted" } }, 403);
    }
    const body = (request.body ?? {}) as { confirmName?: unknown };
    const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
    if (!confirmName || confirmName !== found.name) {
      return jsonOk(
        { error: { code: "confirm_required", message: "Type the desk name to confirm deletion" } },
        400,
      );
    }
    const result = await deleteLocalWorkspace(db, tenant.organizationId, workspaceId);
    if (!result.ok) {
      const status = result.code === "protected" ? 403 : 404;
      const message =
        result.code === "protected" ? "The Default desk cannot be deleted" : "Workspace not found";
      return jsonOk({ error: { code: result.code, message } }, status);
    }
    dropWorkspaceSettings(workspaceId, tenant);
    // The desk's channels and the conversations stored under them go with it: a deleted desk must
    // not leave an outside conversation on disk that nothing in the app can reach any more.
    channelStore().dropWorkspace(tenant, workspaceId);
    if (tenant.workspaceId !== workspaceId) {
      return jsonOk({ ok: true });
    }
    const home = rows.find((row) => row.slug === HOME_WORKSPACE_SLUG && row.id !== workspaceId);
    if (!home) {
      return jsonOk({ ok: true });
    }
    writeSelectedWorkspaceId(home.id);
    return jsonOk({ ok: true, currentWorkspaceId: home.id }, 200, [workspaceCookie(home.id)]);
  } catch (error) {
    return jsonError(error);
  }
}
