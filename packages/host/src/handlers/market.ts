import { ApiError } from "@agentforge/core";
import { marketBriefingSchema } from "@agentforge/core/artifacts";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowedFor } from "../gateway-gate";
import { streamJob } from "../job-stream";
import { buildMarketBoard } from "../market-board";
import { assertBriefingHasNoAdvice } from "../market-briefing-build";
import { buildMarketBriefingDocx } from "../market-docx";
import { generateMarketBriefing, regenerateBriefingSection } from "../market-generate";
import { getTenant } from "../tenant";
import type { HostRequest, HostResult } from "../types";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** `POST /api/v1/market/board` — body: { tickers }; result: MarketBoard. Needs no gateway key. */
export async function handlePostMarketBoard(request: HostRequest): Promise<HostResult> {
  try {
    return jsonOk(await buildMarketBoard(request.body ?? null, {}, request.abortSignal));
  } catch (error) {
    return jsonError(error);
  }
}

/** `POST /api/v1/market` — body: MarketWatchRequest; result: MarketWatchResult. */
export async function handlePostMarket(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await generateMarketBriefing(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** resolving -> quotes -> technicals -> charts -> news -> macro -> drafting -> verifying -> saving, as job.* SSE events. */
export async function handlePostMarketStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return streamJob((emit, abortSignal) => generateMarketBriefing(tenant, request.body ?? null, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** `POST /api/v1/market/regenerate` — body: { briefing, section, instruction?, model? }; result: { section, guard }. */
export async function handlePostMarketRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await regenerateBriefingSection(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** `POST /api/v1/market/docx` — body: { briefing } (or the briefing itself); result: the .docx bytes. */
export async function handlePostMarketDocx(request: HostRequest): Promise<HostResult> {
  try {
    const parsed = marketBriefingSchema.safeParse(
      (request.body as { briefing?: unknown } | null)?.briefing ?? request.body,
    );
    if (!parsed.success) {
      throw new ApiError("invalid_request", "briefing is missing or malformed", 400);
    }
    // The briefing comes from the client: it must pass the advice guard again before anything is rendered.
    assertBriefingHasNoAdvice(parsed.data.sections);
    const { buffer, filename } = await buildMarketBriefingDocx(parsed.data);
    return { type: "bytes", status: 200, bytes: new Uint8Array(buffer), contentType: DOCX_MIME, filename };
  } catch (error) {
    return jsonError(error);
  }
}
