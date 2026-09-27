import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@agentforge/core";
import { parseOpenSlideDeck, type OpenSlideDeck } from "@agentforge/core/open-slide";
import { localDataDir } from "@agentforge/db/vault-key";

export type SavedOpenSlideDeck = {
  id: string;
  savedAt: string;
  deck: OpenSlideDeck;
};

export type SavedOpenSlideSummary = {
  id: string;
  savedAt: string;
  title: string;
};

const DECK_ID = /^oslide_[a-f0-9]{8}$/;

function workspaceFolder(workspaceId: string): string {
  const cleaned = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!cleaned) {
    throw new ApiError("invalid_deck", "A workspace is required to save a deck", 400);
  }
  return join(localDataDir(), "open-slide-decks", cleaned);
}

function assertDeckId(id: string): string {
  if (!DECK_ID.test(id)) {
    throw new ApiError("invalid_deck", "Deck id is not valid", 400);
  }
  return id;
}

export function saveOpenSlideDeck(workspaceId: string, deck: OpenSlideDeck, id?: string): SavedOpenSlideDeck {
  const folder = workspaceFolder(workspaceId);
  mkdirSync(folder, { recursive: true });
  const deckId = id ? assertDeckId(id) : `oslide_${randomBytes(4).toString("hex")}`;
  const saved: SavedOpenSlideDeck = { id: deckId, savedAt: new Date().toISOString(), deck };
  writeFileSync(join(folder, `${deckId}.json`), JSON.stringify(saved));
  return saved;
}

export function listOpenSlideDecks(workspaceId: string): SavedOpenSlideSummary[] {
  const folder = workspaceFolder(workspaceId);
  let names: string[] = [];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  const decks: SavedOpenSlideSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const saved = JSON.parse(readFileSync(join(folder, name), "utf8")) as SavedOpenSlideDeck;
      if (!saved?.id || !saved.deck?.meta?.title) {
        continue;
      }
      decks.push({ id: saved.id, savedAt: saved.savedAt, title: saved.deck.meta.title });
    } catch {
      // A damaged file is skipped. The others still open.
    }
  }
  return decks.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function readOpenSlideDeck(workspaceId: string, id: string): SavedOpenSlideDeck | null {
  const deckId = assertDeckId(id);
  try {
    const raw = JSON.parse(
      readFileSync(join(workspaceFolder(workspaceId), `${deckId}.json`), "utf8"),
    ) as SavedOpenSlideDeck;
    return { id: deckId, savedAt: raw.savedAt, deck: parseOpenSlideDeck(raw.deck) };
  } catch (error) {
    if (error instanceof ApiError && error.code === "invalid_deck") {
      throw error;
    }
    return null;
  }
}
