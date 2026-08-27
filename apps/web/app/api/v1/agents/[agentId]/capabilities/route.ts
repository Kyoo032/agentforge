import { NextResponse } from "next/server";
import { DEFAULT_CHAT_MODEL, isDefaultChatAgent, RUN_PATHS } from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { defaultSelectableModel } from "@/lib/selectable-models";
import { agentService, getTenant } from "@/lib/tenant";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const agent = await agentService.get(tenant, agentId);
    if (!agent) {
      return NextResponse.json({ error: { code: "not_found", message: "Agent not found" } }, { status: 404 });
    }
    const published = agent.currentVersionId
      ? await agentService.getPublishedForRun(tenant, agentId)
      : null;
    return NextResponse.json({
      inputModalities: published?.version.inputModalities ?? ["text"],
      model: isDefaultChatAgent(agent)
        ? defaultSelectableModel()
        : (published?.version.model ?? DEFAULT_CHAT_MODEL),
      published: Boolean(agent.currentVersionId),
      runPaths: RUN_PATHS,
    });
  } catch (error) {
    return jsonError(error);
  }
}
