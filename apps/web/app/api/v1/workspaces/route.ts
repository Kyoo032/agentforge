import { NextResponse } from "next/server";
import {
  WORKSPACE_COOKIE,
  isWorkspaceTemplateId,
  productModesForTemplate,
  requireProductModes,
  resolveWorkspaceModes,
} from "@agentforge/core";
import { createLocalWorkspace, db, listLocalWorkspaces } from "@agentforge/db";
import { jsonError } from "@/lib/http";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { getTenant } from "@/lib/tenant";
import { cookies } from "next/headers";

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
  };
}

export async function GET() {
  try {
    const tenant = await getTenant();
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    return NextResponse.json({
      workspaces: rows.map(serializeWorkspace),
      currentWorkspaceId: tenant.workspaceId,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = (await request.json()) as { name?: string; templatePack?: string; productModes?: unknown };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: { code: "invalid", message: "Name is required" } }, { status: 400 });
    }
    const templatePack = body.templatePack?.trim();
    if (templatePack && !isWorkspaceTemplateId(templatePack)) {
      return NextResponse.json(
        { error: { code: "unknown_template_pack", message: "Unknown workspace template" } },
        { status: 400 },
      );
    }
    const productModes = body.productModes != null
      ? requireProductModes(body.productModes)
      : productModesForTemplate(templatePack || null);
    const workspace = await createLocalWorkspace(
      db,
      tenant.organizationId,
      name,
      templatePack || undefined,
      productModes,
    );
    (await cookies()).set(WORKSPACE_COOKIE, workspace.id, { path: "/", sameSite: "strict", httpOnly: true });
    revalidateAppShell();
    return NextResponse.json({ workspace: serializeWorkspace(workspace), seeded: false }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
