import { NextResponse } from "next/server";
import { WORKSPACE_COOKIE, isWorkspaceTemplateId } from "@agentforge/core";
import { createLocalWorkspace, db, listLocalWorkspaces } from "@agentforge/db";
import { jsonError } from "@/lib/http";
import { seedWorkspaceStarter } from "@/lib/seed-workspace";
import { getTenant } from "@/lib/tenant";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const tenant = await getTenant();
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    return NextResponse.json({
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        templatePack: row.templatePack ?? null,
      })),
      currentWorkspaceId: tenant.workspaceId,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = (await request.json()) as { name?: string; templatePack?: string };
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
    const workspace = await createLocalWorkspace(
      db,
      tenant.organizationId,
      name,
      templatePack || undefined,
    );
    (await cookies()).set(WORKSPACE_COOKIE, workspace.id, { path: "/", sameSite: "strict", httpOnly: true });

    let seeded = false;
    if (templatePack) {
      seeded = await seedWorkspaceStarter(tenant, workspace.id, templatePack);
    }

    return NextResponse.json({ workspace, seeded }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
