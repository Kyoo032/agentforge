import { ApiError } from "@agentforge/core";
import { parseOpenSlideDeck, type OpenSlideDeck } from "@agentforge/core/open-slide";
import { ZodError } from "zod";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowedFor } from "../gateway-gate";
import { listOpenSlideDecks, readOpenSlideDeck, saveOpenSlideDeck } from "../open-slide-decks";
import { generateOpenSlideDeck } from "../open-slide-generate";
import { buildOpenSlidePptx } from "../open-slide-pptx";
import { getTenant } from "../tenant";
import type { HostRequest, HostResult } from "../types";

function readDeck(input: unknown): OpenSlideDeck {
  try {
    return parseOpenSlideDeck(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError("invalid_request", "Open Slide deck is not valid", 400);
    }
    throw error;
  }
}

export async function handlePostOpenSlide(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    requireGatewayAllowedFor(tenant);
    return jsonOk(await generateOpenSlideDeck(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** The caller already holds the deck. Nothing here reaches the gateway. */
export async function handlePostOpenSlidePptx(request: HostRequest): Promise<HostResult> {
  try {
    const deck = readDeck(request.body ?? null);
    const { buffer, filename } = await buildOpenSlidePptx(deck);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(buffer),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename,
    };
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetOpenSlideDecks(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const id = request.query.id?.trim();
    if (id) {
      const deck = readOpenSlideDeck(tenant.workspaceId, id);
      if (!deck) {
        throw new ApiError("not_found", "Deck not found", 404);
      }
      return jsonOk({ deck });
    }
    return jsonOk({ decks: listOpenSlideDecks(tenant.workspaceId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostOpenSlideDeck(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = request.body;
    const record = body && typeof body === "object" ? (body as { id?: unknown; deck?: unknown }) : {};
    const deck = readDeck(record.deck);
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
    return jsonOk({ deck: saveOpenSlideDeck(tenant.workspaceId, deck, id) });
  } catch (error) {
    return jsonError(error);
  }
}
