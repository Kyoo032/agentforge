import { ApiError } from "@agentforge/core";
import { artifactFilename, isArtifactMode } from "@agentforge/core/artifacts";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
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
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(Buffer.from(artifact.body, "utf8")),
      contentType: `${artifact.mime}; charset=utf-8`,
      filename: artifactFilename(artifact.title, artifact.mime),
    };
  } catch (error) {
    return jsonError(error);
  }
}
