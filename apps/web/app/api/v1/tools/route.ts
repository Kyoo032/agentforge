import { NextResponse } from "next/server";
import { listToolRoutes, listTools } from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { ensureToolsRegistered } from "@/lib/register-tools";
import { loadSettings } from "@/lib/settings-store";

export async function GET() {
  try {
    await getTenant();
    ensureToolsRegistered();
    const routes = listToolRoutes(loadSettings());
    return NextResponse.json({
      tools: listTools().map((tool) => ({
        key: tool.key,
        name: tool.name,
        description: tool.description,
        capability: tool.capability,
        pack: tool.pack,
        ready: !tool.capability || Boolean(routes[tool.capability]?.ready),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
