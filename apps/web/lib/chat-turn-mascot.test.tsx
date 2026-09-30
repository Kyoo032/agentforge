/**
 * The live chat turn's mascot is decorative. The Thinking disclosure and the streamed text beside it
 * already say what the turn is doing, so a named mascot made a screen reader announce "Thinking it
 * through" twice.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTurn } from "@/components/chat-turn";

const live = { thinking: "", tools: [], streaming: "", running: true };

describe("the live chat turn's mascot", () => {
  it("is hidden from screen readers while the turn runs", () => {
    const html = renderToStaticMarkup(<ChatTurn role="assistant" live={live} />);
    const mascot = html.match(/<span[^>]*data-testid="chat-mascot"[^>]*>/)?.[0] ?? "";
    expect(mascot).not.toBe("");
    expect(mascot).toContain('aria-hidden="true"');
    expect(mascot).not.toMatch(/\brole="img"/);
    expect(mascot).not.toMatch(/\baria-label=/);
    expect(mascot).not.toMatch(/\btitle=/);
  });

  it("is hidden when the turn failed too", () => {
    const html = renderToStaticMarkup(<ChatTurn role="assistant" live={{ ...live, running: false, failed: true }} />);
    const mascot = html.match(/<span[^>]*data-testid="chat-mascot"[^>]*>/)?.[0] ?? "";
    expect(mascot).toContain('data-state="error"');
    expect(mascot).toContain('aria-hidden="true"');
  });
});
