import { NextResponse } from "next/server";
import { isDefaultChatAgent } from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { defaultSelectableModel, listSelectableModels } from "@/lib/selectable-models";

export async function GET() {
  try {
    const tenant = await getTenant();
    const ready = await agentService.ensureDefaultChat(tenant);
    const specialists = (await agentService.list(tenant))
      .filter((agent) => !isDefaultChatAgent(agent) && agent.currentVersionId)
      .filter((agent) => !/office[- ]hours/i.test(agent.slug) && !/office hours/i.test(agent.name))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
      }));
    return NextResponse.json({
      agent: ready.agent,
      version: ready.version,
      models: listSelectableModels(),
      defaultModel: defaultSelectableModel(),
      specialists,
    });
  } catch (error) {
    return jsonError(error);
  }
}
