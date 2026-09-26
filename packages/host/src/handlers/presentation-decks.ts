import { ApiError } from "@agentforge/core";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import type { HostRequest, HostResult } from "../types";
import { parsePresentationOutlineBody } from "../presentation-outline";
import { listPresentationDecks, readPresentationDeck, savePresentationDeck } from "../presentation-decks";

/** Saved decks are local files. They do not call the gateway. */
export async function handleGetPresentationDecks(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const id = request.query.id?.trim();
    if (id) {
      const deck = readPresentationDeck(tenant.workspaceId, id);
      if (!deck) {
        throw new ApiError("not_found", "Deck not found", 404);
      }
      return jsonOk({ deck });
    }
    return jsonOk({ decks: listPresentationDecks(tenant.workspaceId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentationDeck(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = request.body;
    const record = body && typeof body === "object" ? (body as { id?: unknown; outline?: unknown }) : {};
    const outline = parsePresentationOutlineBody(record.outline);
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
    const deck = savePresentationDeck(tenant.workspaceId, outline, id);
    return jsonOk({ deck });
  } catch (error) {
    return jsonError(error);
  }
}
