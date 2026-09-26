import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { ApiError } from "@agentforge/core";
import { parsePresentationOutlineBody, type PresentationOutline } from "./presentation-outline";

export type SavedDeck = {
  id: string;
  savedAt: string;
  outline: PresentationOutline;
};

export type SavedDeckSummary = {
  id: string;
  savedAt: string;
  title: string;
};

const DECK_ID = /^deck_[a-f0-9]{8}$/;

function workspaceFolder(workspaceId: string): string {
  const cleaned = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!cleaned) {
    throw new ApiError("invalid_deck", "A workspace is required to save a deck", 400);
  }
  return join(localDataDir(), "presentation-decks", cleaned);
}

function assertDeckId(id: string): string {
  if (!DECK_ID.test(id)) {
    throw new ApiError("invalid_deck", "Deck id is not valid", 400);
  }
  return id;
}

export function savePresentationDeck(workspaceId: string, outline: PresentationOutline, id?: string): SavedDeck {
  const folder = workspaceFolder(workspaceId);
  mkdirSync(folder, { recursive: true });
  const deckId = id ? assertDeckId(id) : `deck_${randomBytes(4).toString("hex")}`;
  const saved: SavedDeck = { id: deckId, savedAt: new Date().toISOString(), outline };
  writeFileSync(join(folder, `${deckId}.json`), JSON.stringify(saved));
  return saved;
}

export function listPresentationDecks(workspaceId: string): SavedDeckSummary[] {
  const folder = workspaceFolder(workspaceId);
  let names: string[] = [];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  const decks: SavedDeckSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const saved = JSON.parse(readFileSync(join(folder, name), "utf8")) as SavedDeck;
      if (!saved?.id || !saved.outline?.title) {
        continue;
      }
      decks.push({ id: saved.id, savedAt: saved.savedAt, title: saved.outline.title });
    } catch {
      // A damaged file is skipped. The others still open.
    }
  }
  return decks.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function readPresentationDeck(workspaceId: string, id: string): SavedDeck | null {
  const deckId = assertDeckId(id);
  try {
    const raw = JSON.parse(readFileSync(join(workspaceFolder(workspaceId), `${deckId}.json`), "utf8")) as SavedDeck;
    return { id: deckId, savedAt: raw.savedAt, outline: parsePresentationOutlineBody(raw.outline) };
  } catch (error) {
    if (error instanceof ApiError && error.code === "invalid_deck") {
      throw error;
    }
    return null;
  }
}
