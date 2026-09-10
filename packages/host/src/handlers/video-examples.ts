import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { listVideoExamples, readVideoExample, VIDEO_EXAMPLE_MIME } from "../video-examples";

/** Bundled example clips for the Videos studio. Works without a gateway key and without a workspace. */
export async function handleGetVideoExamples(_request: HostRequest): Promise<HostResult> {
  try {
    return jsonOk({ examples: listVideoExamples() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetVideoExampleFile(request: HostRequest): Promise<HostResult> {
  try {
    const name = request.params.name ?? "";
    const bytes = await readVideoExample(name);
    if (!bytes) {
      return jsonOk({ error: { code: "not_found", message: "Example clip not found" } }, 404);
    }
    return { type: "bytes", status: 200, bytes, contentType: VIDEO_EXAMPLE_MIME };
  } catch (error) {
    return jsonError(error);
  }
}
