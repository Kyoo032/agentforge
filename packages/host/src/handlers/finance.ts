import { financeBriefSchema } from "@agentforge/core/artifacts";
import { ApiError } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { buildFinanceDocx } from "../finance-docx";
import { generateFinanceBrief, parseFinanceFigures, regenerateFinanceSection } from "../finance-generate";
import { financeBootLocale, financeCopy } from "../finance-locale";
import { streamJob } from "../job-stream";

export async function handlePostFinance(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await generateFinanceBrief(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** computing -> drafting -> verifying -> saving, as job.* SSE events. */
export async function handlePostFinanceStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return streamJob((emit, abortSignal) => generateFinanceBrief(tenant, request.body ?? null, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** Free text → line items for the user to confirm. No metrics are computed here. */
export async function handlePostFinanceParse(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await parseFinanceFigures(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostFinanceRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await regenerateFinanceSection(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostFinanceDocx(request: HostRequest): Promise<HostResult> {
  try {
    const parsed = financeBriefSchema.safeParse((request.body as { brief?: unknown } | null)?.brief ?? request.body);
    if (!parsed.success) {
      throw new ApiError("invalid_request", financeCopy().errors.briefMalformed, 400);
    }
    const { buffer, filename } = await buildFinanceDocx(parsed.data, financeBootLocale());
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
