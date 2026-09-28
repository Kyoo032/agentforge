/**
 * Role fallback for a person who did not tag their files.
 * Classify still proposes roles. This only runs when that proposal left no counterparty draft.
 */

import type { MatterDocCard } from "./types";

export function assumeSingleCounterpartyDraft(cards: readonly MatterDocCard[]): {
  cards: MatterDocCard[];
  assumed: MatterDocCard | null;
} {
  const hasDraft = cards.some((card) => card.role === "counterparty-draft" && card.status === "read");
  if (hasDraft) {
    return { cards: cards.map((card) => ({ ...card })), assumed: null };
  }
  const untagged = cards.filter((card) => card.role === "context" && card.status === "read");
  const only = untagged.length === 1 ? untagged[0] : undefined;
  if (!only) {
    return { cards: cards.map((card) => ({ ...card })), assumed: null };
  }
  const assumed: MatterDocCard = { ...only, role: "counterparty-draft" };
  return {
    cards: cards.map((card) => (card.id === only.id ? assumed : { ...card })),
    assumed,
  };
}
