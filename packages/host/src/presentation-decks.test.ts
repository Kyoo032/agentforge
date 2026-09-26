import { describe, expect, it } from "vitest";
import { parsePresentationOutlineBody } from "./presentation-outline";
import { listPresentationDecks, readPresentationDeck, savePresentationDeck } from "./presentation-decks";

describe("presentation decks", () => {
  const outline = parsePresentationOutlineBody({
    title: "Saved deck",
    slides: [{ heading: "One", bullets: ["Keep this"], notes: "Say it" }],
  });

  it("writes a deck and reads it back for the same workspace", () => {
    const saved = savePresentationDeck("ws-deck-test", outline);
    expect(saved.id).toMatch(/^deck_[a-f0-9]{8}$/);
    const listed = listPresentationDecks("ws-deck-test");
    expect(listed.some((deck) => deck.id === saved.id && deck.title === "Saved deck")).toBe(true);
    const loaded = readPresentationDeck("ws-deck-test", saved.id);
    expect(loaded?.outline.slides[0]?.heading).toBe("One");
    expect(readPresentationDeck("other-desk", saved.id)).toBeNull();
  });

  it("replaces a deck when the same id is saved again", () => {
    const saved = savePresentationDeck("ws-deck-replace", outline);
    const next = parsePresentationOutlineBody({
      title: "Replaced",
      slides: [{ heading: "Two", bullets: ["Changed"], notes: "" }],
    });
    savePresentationDeck("ws-deck-replace", next, saved.id);
    expect(readPresentationDeck("ws-deck-replace", saved.id)?.outline.title).toBe("Replaced");
  });
});
