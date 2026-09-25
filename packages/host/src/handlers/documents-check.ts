import { checkDraftAgainstSource } from "@agentforge/core";
import { jsonError, jsonOk } from "../errors";
import { parseDocumentDraftBody } from "../document-outline";
import type { HostRequest, HostResult } from "../types";

/** Overlap check. No model call and no gateway gate. */
export async function handlePostDocumentsCheck(request: HostRequest): Promise<HostResult> {
  try {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as { draft?: unknown; sourceText?: unknown })
        : {};
    const draft = parseDocumentDraftBody(body.draft);
    const sourceText = typeof body.sourceText === "string" ? body.sourceText : "";
    return jsonOk(checkDraftAgainstSource(draft, sourceText));
  } catch (error) {
    return jsonError(error);
  }
}
