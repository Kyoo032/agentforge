import { ApiError } from "@agentforge/core";
import { artifactFilename, isArtifactMode, isBinaryArtifactMime } from "@agentforge/core/artifacts";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { deleteSourceByOrigin } from "../knowledge";
import { getTenant } from "../tenant";
import { artifactStore, requireArtifact } from "../artifacts";

export async function handleGetArtifacts(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const mode = request.query.mode;
    if (mode !== undefined && mode !== "" && !isArtifactMode(mode)) {
      throw new ApiError("invalid_request", "Unknown artifact mode", 400);
    }
    const items = artifactStore().list(tenant, isArtifactMode(mode) ? mode : undefined);
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetArtifact(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(requireArtifact(tenant, request.params.artifactId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteArtifact(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    if (!artifactStore().remove(tenant, request.params.artifactId)) {
      throw new ApiError("not_found", "Artifact not found", 404);
    }
    // Its Knowledge work card goes too. The artifact is already gone, so this can only warn.
    try {
      deleteSourceByOrigin(tenant, { kind: "artifact", id: request.params.artifactId });
    } catch (error) {
      console.warn(
        `artifacts: could not drop knowledge card for ${request.params.artifactId} (${error instanceof Error ? error.message : "unknown"})`,
      );
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** Native save on desktop comes for free: `apiFetch` writes any bytes result with a filename. */
export async function handleGetArtifactFile(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const artifact = requireArtifact(tenant, request.params.artifactId);
    const binary = isBinaryArtifactMime(artifact.mime);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(Buffer.from(artifact.body, binary ? "base64" : "utf8")),
      contentType: binary ? artifact.mime : `${artifact.mime}; charset=utf-8`,
      filename: artifactFilename(artifact.title, artifact.mime),
    };
  } catch (error) {
    return jsonError(error);
  }
}
