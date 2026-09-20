/**
 * Components: the native dependencies the app installs for itself on first run.
 *
 * NOT GATED — neither route calls `requireGatewayAllowed()`, on purpose. A component is installed
 * before the owner has pasted a gateway key (that is the point: the first document they drag in
 * should already read), so gating these on a key would make first run depend on the very thing the
 * owner has not done yet. Nothing here reaches the gateway, spends anything, or touches a key: the
 * only outbound call is to `registry.npmjs.org` for a URL pinned in `components/manifest.ts`.
 */
import { ApiError, isServerMode } from "@agentforge/core";
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
/** Reason code and message for an install the hosted service does not offer. */
export const INSTALL_DISABLED_CODE = "install_disabled";
export const INSTALL_DISABLED_MESSAGE =
  "Installing components is not available on the hosted service. The components this server needs " +
  "are built into its image; if one is reported missing, that is for the operator to fix.";

export async function handlePostComponentInstallStream(request: HostRequest): Promise<HostResult> {
  try {
    /*
     * MACHINE-WIDE, SO NOT A TENANT'S TO SPEND (docs/internal/security-owasp-2026-09.md, A01-3).
     *
     * The route was session-gated but nothing more, and an install is not a per-tenant action: it
     * spends the box's bandwidth, writes ~8 MB into the shared `/data/components`, and ends by
     * `createRequire`-ing a native `.node` binary out of that directory
     * (`../file-extract/anydoc.ts`). Any signed-in tenant could drive that loop for everybody.
     *
     * Refusing it costs the hosted deployment nothing, because the image already bundles anydoc and
     * `reportComponentStatus` resolves the bundled copy first (`../components/status.ts`) — the
     * first-boot download path is unused there by design, which is also what security spec H3 wants
     * kept true so `/data` can eventually be mounted `noexec`. The desktop and webdev, where first
     * run IS the install, are untouched.
     */
    if (isServerMode()) {
      throw new ApiError(INSTALL_DISABLED_CODE, INSTALL_DISABLED_MESSAGE, 403);
    }
    const id = parseInstallBody(request.body);
    return streamJob((emit, abortSignal) => installComponent(id, { emit, abortSignal }), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}
