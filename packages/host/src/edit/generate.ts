import { ApiError, maskPii } from "@agentforge/core";
import { generateFailureMessage } from "./generate-failure";

export type GenerateSubmitResult = {
  status: number;
  body: unknown;
  outputAssetIds?: string[];
};

export type GenerateSubmitFn = (input: {
  kind: "generate_image" | "generate_video";
  request: unknown;
  signal: AbortSignal;
}) => Promise<GenerateSubmitResult>;

const PREPAID = /prepaid_async_requires_fixed_price/i;

let submitImpl: GenerateSubmitFn | null = null;

export function setGenerateSubmit(next: GenerateSubmitFn | null): void {
  submitImpl = next;
}

export function isPrepaidFailure(status: number, body: unknown): boolean {
  if (status !== 403) {
    return false;
  }
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return PREPAID.test(text) || text.includes("prepaid");
}

export function maskGeneratePrompt(request: unknown): unknown {
  if (!request || typeof request !== "object") {
    return request;
  }
  const record = { ...(request as Record<string, unknown>) };
  if (typeof record.prompt === "string") {
    record.prompt = maskPii(record.prompt);
  }
  return record;
}

export async function runGenerateJob(
  kind: "generate_image" | "generate_video",
  request: unknown,
  signal: AbortSignal,
): Promise<{ outputAssetIds: string[] }> {
  const masked = maskGeneratePrompt(request);
  if (!submitImpl) {
    throw new ApiError("not_enabled_in_phase_1", "Generation is not enabled in phase 1", 400);
  }
  const attempt = async () => submitImpl!({ kind, request: masked, signal });
  let result: GenerateSubmitResult;
  try {
    result = await attempt();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    result = await attempt();
  }
  if (isPrepaidFailure(result.status, result.body)) {
    throw new ApiError("prepaid_async_requires_fixed_price", "Prepaid async generation is not retried", 403);
  }
  if (result.status >= 400 && result.status < 500) {
    throw new ApiError("generate_failed", generateFailureMessage(result.status, result.body), 400);
  }
  if (result.status >= 500) {
    const retry = await attempt();
    if (retry.status >= 400) {
      throw new ApiError("generate_failed", generateFailureMessage(retry.status, retry.body), 400);
    }
    return { outputAssetIds: retry.outputAssetIds ?? [] };
  }
  return { outputAssetIds: result.outputAssetIds ?? [] };
}
