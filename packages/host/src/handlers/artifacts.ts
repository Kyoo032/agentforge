import { ApiError } from "@agentforge/core";
import { ARTIFACT_MIMES, artifactFilename, isArtifactMode, isBinaryArtifactMime } from "@agentforge/core/artifacts";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { deleteSourceByOrigin } from "../knowledge";
import { getTenant } from "../tenant";
import { artifactStore, requireArtifact } from "../artifacts";
import { log } from "../log";

export async function handleGetArtifacts(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
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
    const tenant = await getTenant(request);
    return jsonOk(requireArtifact(tenant, request.params.artifactId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteArtifact(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    if (!artifactStore().remove(tenant, request.params.artifactId)) {
      throw new ApiError("not_found", "Artifact not found", 404);
    }
    // Its Knowledge work card goes too. The artifact is already gone, so this can only warn.
    try {
      deleteSourceByOrigin(tenant, { kind: "artifact", id: request.params.artifactId });
    } catch (error) {
      log.warn("artifacts_knowledge_card_not_dropped", {
        artifactId: request.params.artifactId,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * What an artifact body is allowed to be called on the wire. Only the four types the artifact
 * catalog mints; anything else — a row written by an older build, a type a future writer adds
 * without thinking about the browser — is renamed to the inert one.
 */
const SERVED_ARTIFACT_MIMES: ReadonlySet<string> = new Set(ARTIFACT_MIMES);

export const INERT_ARTIFACT_MIME = "application/octet-stream";

/**
 * Per-response sandbox on every artifact body (hosted XSS audit; web-security-spec A3/A7).
 *
 * The body is model-written and is served from the app's own origin, so if a browser ever decided
 * to render it — a future artifact type, a saved file re-opened from disk, a `Content-Disposition`
 * a proxy stripped — this header leaves it with an opaque origin: no cookies, no same-origin fetch,
 * and with no `allow-scripts` token, no script at all.
 */
export const ARTIFACT_FILE_CSP = "sandbox";

/** A quote, a backslash or a control byte would end the parameter or start a header of its own. */
function isUnsafeFilenameChar(char: string): boolean {
  return char < " " || char === "" || char === '"' || char === "\\";
}

function quotableFilename(filename: string): string {
  return Array.from(filename, (char) => (isUnsafeFilenameChar(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The content type and headers an artifact body is served with. Split out from the handler so the
 * audit's cases (html, svg, xhtml, png) can be pinned without writing such a row to the store,
 * which `artifactStore()` would coerce back to markdown on read.
 */
export function artifactFileDelivery(
  mime: string,
  filename: string,
): { contentType: string; headers: Record<string, string> } {
  const known = SERVED_ARTIFACT_MIMES.has(mime);
  const contentType = !known ? INERT_ARTIFACT_MIME : isBinaryArtifactMime(mime) ? mime : `${mime}; charset=utf-8`;
  return {
    contentType,
    headers: {
      "Content-Disposition": `attachment; filename="${quotableFilename(filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": ARTIFACT_FILE_CSP,
    },
  };
}

/** Native save on desktop comes for free: `apiFetch` writes any bytes result with a filename. */
export async function handleGetArtifactFile(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const artifact = requireArtifact(tenant, request.params.artifactId);
    const filename = artifactFilename(artifact.title, artifact.mime);
    const delivery = artifactFileDelivery(artifact.mime, filename);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(Buffer.from(artifact.body, isBinaryArtifactMime(artifact.mime) ? "base64" : "utf8")),
      contentType: delivery.contentType,
      filename,
      headers: delivery.headers,
    };
  } catch (error) {
    return jsonError(error);
  }
}
