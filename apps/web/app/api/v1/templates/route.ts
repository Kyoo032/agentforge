import { NextResponse } from "next/server";
import { defaultAgentPack } from "@agentforge/core";
import { agentPacks } from "@agentforge/university";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";

export async function GET() {
  try {
    await getTenant();
    return NextResponse.json({ packs: [defaultAgentPack, ...agentPacks] });
  } catch (error) {
    return jsonError(error);
  }
}
