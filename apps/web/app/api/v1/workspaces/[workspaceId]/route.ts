import { NextResponse } from "next/server";
import { requireProductModes, resolveWorkspaceModes } from "@agentforge/core";
import { db, listLocalWorkspaces, updateLocalWorkspace } from "@agentforge/db";
import { jsonError } from "@/lib/http";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { getTenant } from "@/lib/tenant";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { workspaceId } = await context.params;
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    const found = rows.find((row) => row.id === workspaceId);
    if (!found) {
      return NextResponse.json({ error: { code: "not_found", message: "Workspace not found" } }, { status: 404 });
    }
    const body = (await request.json()) as { name?: string; productModes?: unknown };
    const productModes = body.productModes != null ? requireProductModes(body.productModes) : undefined;
    const updated = await updateLocalWorkspace(db, tenant.organizationId, workspaceId, {
      name: body.name,
      productModes,
    });
    revalidateAppShell();
    return NextResponse.json({
      workspace: updated
        ? {
            id: updated.id,
            name: updated.name,
            slug: updated.slug,
            templatePack: updated.templatePack ?? null,
            productModes: resolveWorkspaceModes(updated.productModes),
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
