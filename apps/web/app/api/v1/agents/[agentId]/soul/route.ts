import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { agentService, getTenant } from "@/lib/tenant";
import type { InputModality } from "@agentforge/core";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json().catch(() => null);
    const input =
      body && typeof body === "object"
        ? {
            systemPrompt:
              "systemPrompt" in body
                ? (body as { systemPrompt?: string }).systemPrompt
                : undefined,
            model: "model" in body ? (body as { model?: string }).model : undefined,
            inputModalities:
              "inputModalities" in body
                ? (body as { inputModalities?: InputModality[] }).inputModalities
                : undefined,
            toolKeys: "toolKeys" in body ? (body as { toolKeys?: string[] }).toolKeys : undefined,
          }
        : {};
    const { version } = await agentService.createRevision(tenant, agentId, input);
    revalidateAppShell();
    return NextResponse.json({ version: { id: version.id, version: version.version } });
  } catch (error) {
    return jsonError(error);
  }
}
