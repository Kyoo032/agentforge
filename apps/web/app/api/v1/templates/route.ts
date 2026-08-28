import { NextResponse } from "next/server";
import { defaultAgentPack } from "@agentforge/core";
import { legalAgentPacks } from "@agentforge/legal";
import { marketingAgentPacks } from "@agentforge/marketing";
import { agentPacks } from "@agentforge/university";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";

export async function GET() {
  try {
    await getTenant();
    return NextResponse.json({
      packs: [defaultAgentPack, ...agentPacks, ...marketingAgentPacks, ...legalAgentPacks],
    });
  } catch (error) {
    return jsonError(error);
  }
}
