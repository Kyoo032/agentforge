import { ApiError, GUIDE_OUTCOMES, guidePayload, isGuideOutcome } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { saveUserGuide } from "../settings-store";
import { getTenant } from "../tenant";

/**
 * `POST /api/v1/settings/guide` — record how the first-run guide ended.
 *
 * Its own route rather than a field on `POST /api/v1/settings`: a settings save revokes the
 * knowledge model row, clears three breakers and re-probes the gateway, and none of that should
 * happen because somebody pressed Skip. Not gated by the gateway either: the guide is offered on the
 * desk the gate opened, but recording that it was dismissed must work on any desk that can show it.
 *
 * The body is `{ outcome: "finished" | "skipped" | "closed" }`. There is no way to un-record it over
 * the wire; "Start over" removes the sealed settings payload it lives in, and that is the reset.
 */
export async function handlePostGuide(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as { outcome?: unknown };
    if (!isGuideOutcome(body.outcome)) {
      throw new ApiError("invalid_request", `outcome must be one of ${GUIDE_OUTCOMES.join(", ")}`, 400);
    }
    return jsonOk({ guide: guidePayload(saveUserGuide(tenant, body.outcome)) });
  } catch (error) {
    return jsonError(error);
  }
}
