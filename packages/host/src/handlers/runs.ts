import type { InputModality } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError } from "../errors";
import { requireGatewayAllowed } from "../gateway-gate";
import { loadSettings } from "../settings-store";
import { getTenant } from "../tenant";
import { startModalityRun } from "../runs";

async function asStream(events: AsyncIterable<string>): Promise<HostResult> {
  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();
  async function* rest() {
    if (!first.done) {
      yield first.value;
    }
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
  return { type: "stream", status: 200, events: rest() };
}

export async function handleRun(request: HostRequest, modality: InputModality): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    return await asStream(
      startModalityRun({
        tenant,
        threadId: request.params.threadId,
        modality,
        body: request.body,
        abortSignal: request.abortSignal,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
