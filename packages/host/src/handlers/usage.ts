import { parseUsageRange } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { loadSettings } from "../settings-store";
import { loadRangeUsage } from "../account-usage";

export async function handleGetUsage(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const range = parseUsageRange(request.query.range);
    return jsonOk(await loadRangeUsage(loadSettings(tenant.workspaceId), tenant, range));
  } catch (error) {
    return jsonError(error);
  }
}
