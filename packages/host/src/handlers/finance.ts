import { financeBriefSchema } from "@agentforge/core/artifacts";
import { ApiError } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowed } from "../gateway-gate";
import { loadSettings } from "../settings-store";
import { getTenant } from "../tenant";
import { buildFinanceDocx } from "../finance-docx";
import { generateFinanceBrief, regenerateFinanceSection } from "../finance-generate";
import { requireFinanceTask } from "../finance-task";
import { financeTaskParser } from "../finance-tasks/parsers";
import { streamJob } from "../job-stream";

export async function handlePostFinance(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    // `task` is validated before anything reaches the gateway: a task that ships
    // later is a 400 here, not a half-run pipeline.
    requireFinanceTask(request.body ?? null);
    return jsonOk(await generateFinanceBrief(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** computing -> drafting -> verifying -> saving, as job.* SSE events. */
export async function handlePostFinanceStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    requireFinanceTask(request.body ?? null);
    return streamJob((emit, abortSignal) => generateFinanceBrief(tenant, request.body ?? null, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Free text → the confirmed input its task asks for. No metrics are computed here.
 *
 * The task picks the parser, so a task worker adds `finance-tasks/parse-<task>.ts` instead of
 * editing a switch here; a task without one still gets the brief's line-item read.
 */
export async function handlePostFinanceParse(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const task = requireFinanceTask(request.body ?? null);
    return jsonOk(await financeTaskParser(task)(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostFinanceRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    requireFinanceTask(request.body ?? null);
    return jsonOk(await regenerateFinanceSection(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostFinanceDocx(request: HostRequest): Promise<HostResult> {
  try {
    const parsed = financeBriefSchema.safeParse((request.body as { brief?: unknown } | null)?.brief ?? request.body);
    if (!parsed.success) {
      throw new ApiError("invalid_request", "brief is missing or malformed", 400);
    }
    const { buffer, filename } = await buildFinanceDocx(parsed.data);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(buffer),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename,
    };
  } catch (error) {
    return jsonError(error);
  }
}
