/**
 * The model catalogue as the host puts it on the wire, and the one rule that reads it back.
 *
 * `GET /api/v1/models` used to answer with one list per mode, and eight of those modes (documents,
 * research, presentations, finance, data, market, legal, meeting) offer exactly the chat catalogue,
 * so the same 126 rows travelled nine times: 261 KB of a 298 KB answer, and 261 KB of a 274 KB
 * `GET /api/v1/settings` besides. In the packaged app both cross IPC and are stringified on one
 * side and parsed on the other, on every read.
 *
 * The wire now says each thing once:
 *  - `models` is the chat catalogue, the picker for Chat **and** for every mode in
 *    `CHAT_CATALOG_MODES`. Nothing repeats it per mode.
 *  - `modes` carries only the lists that are not the chat catalogue (image, video, audio, other,
 *    music, embedding). A host that still sends its own list for a chat-shaped mode wins, so a mode
 *    that one day gets a curated list of its own needs no change here.
 *
 * Browser-safe: no imports, so the renderer takes it through the `@agentforge/core/mode-catalog`
 * subpath without pulling the Node-only barrel.
 */

/** Modes whose picker is the chat catalogue itself. `chat` is one of them; the job modes are the rest. */
export const CHAT_CATALOG_MODES = [
  "chat",
  "documents",
  "research",
  "presentations",
  "finance",
  "data",
  "market",
  "legal",
  "meeting",
] as const;

export type ChatCatalogMode = (typeof CHAT_CATALOG_MODES)[number];

/** The kinds the host lists next to the chat catalogue, each a different set of rows. */
export const OWN_CATALOG_MODES = ["image", "video", "audio", "other", "music", "embedding"] as const;

export type OwnCatalogMode = (typeof OWN_CATALOG_MODES)[number];

/** What a caller needs from an `/api/v1/models` answer to pick a mode's models. */
export type ModelCatalogWire<T> = {
  /** The chat catalogue, once. */
  models?: readonly T[] | null;
  /** Only the lists that differ from `models`. */
  modes?: Partial<Record<string, readonly T[] | null>> | null;
};

const CHAT_SHAPED: ReadonlySet<string> = new Set(CHAT_CATALOG_MODES);

export function isChatCatalogMode(mode: string): boolean {
  return CHAT_SHAPED.has(mode);
}

/**
 * The models a mode's picker offers.
 *
 * A list the host sent for this mode wins; otherwise a chat-shaped mode gets `models`; anything
 * else is empty rather than a guess, because a media mode handed the chat catalogue would offer a
 * chat model to an image request.
 */
export function modelsForMode<T>(payload: ModelCatalogWire<T> | null | undefined, mode: string): readonly T[] {
  const own = payload?.modes?.[mode];
  if (Array.isArray(own)) {
    return own;
  }
  if (isChatCatalogMode(mode) && Array.isArray(payload?.models)) {
    return payload.models;
  }
  return [];
}
