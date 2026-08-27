import { NextResponse } from "next/server";
import { WORKSPACE_COOKIE } from "@agentforge/core";
import { db, listLocalWorkspaces } from "@agentforge/db";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { cookies } from "next/headers";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { workspaceId } = await context.params;
    const rows = await listLocalWorkspaces(db, tenant.organizationId);
    const found = rows.find((row) => row.id === workspaceId);
    if (!found) {
      return NextResponse.json({ error: { code: "not_found", message: "Workspace not found" } }, { status: 404 });
    }
    (await cookies()).set(WORKSPACE_COOKIE, found.id, { path: "/", sameSite: "strict", httpOnly: true });
    return NextResponse.json({ workspace: { id: found.id, name: found.name, slug: found.slug } });
  } catch (error) {
    return jsonError(error);
  }
}
