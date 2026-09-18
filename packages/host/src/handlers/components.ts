/**
 * Components: the native dependencies the app installs for itself on first run.
 *
 * NOT GATED — neither route calls `requireGatewayAllowed()`, on purpose. A component is installed
 * before the owner has pasted a gateway key (that is the point: the first document they drag in
 * should already read), so gating these on a key would make first run depend on the very thing the
 * owner has not done yet. Nothing here reaches the gateway, spends anything, or touches a key: the
 * only outbound call is to `registry.npmjs.org` for a URL pinned in `components/manifest.ts`.
 */
import { ApiError } from "@agentforge/core";
import { z } from "zod";
import { installComponent, reportComponentStatus } from "../components/install";
import { COMPONENT_IDS } from "../components/types";
import { jsonError, jsonOk } from "../errors";
import { streamJob } from "../job-stream";
import type { HostRequest, HostResult } from "../types";

/** The id is the only input, and it is an enum: no URL, version or path ever comes from a body. */
const installBodySchema = z.object({ id: z.enum(COMPONENT_IDS) });

function parseInstallBody(body: unknown): (typeof COMPONENT_IDS)[number] {
  const parsed = installBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError("invalid_request", `id must be one of: ${COMPONENT_IDS.join(", ")}`, 400);
  }
  return parsed.data.id;
}

/** `{ components: [...] }` — every manifest component, whether or not it is installed. */
export async function handleGetComponents(_request: HostRequest): Promise<HostResult> {
  try {
    return jsonOk({ components: COMPONENT_IDS.map((id) => reportComponentStatus(id)) });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * check -> download -> verify -> unpack -> probe -> marker, as `job.*` SSE events.
 *
 * Same `streamJob` shape as the Research / Finance / Data streams, so it works unchanged over both
 * webdev HTTP and the packaged Electron IPC transport.
 */
export async function handlePostComponentInstallStream(request: HostRequest): Promise<HostResult> {
  try {
    const id = parseInstallBody(request.body);
    return streamJob((emit, abortSignal) => installComponent(id, { emit, abortSignal }), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}
