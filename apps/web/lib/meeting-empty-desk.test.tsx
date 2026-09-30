/**
 * An empty Meeting desk shows the character once (2026-09-29 sweep). The recordings list and the main
 * pane both drew it, and both said the "create one, add the recording" sentence, so a wide window showed
 * the same picture and line side by side and a phone showed them stacked. The main pane keeps the
 * character and the sentence: it is where the minutes will appear. The list keeps one line, "No meetings yet."
 *
 * The environment is node with no DOM: the studio is rendered to markup with its first state (no
 * meetings, none selected), which is the empty desk.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MeetingStudio } from "@/components/meeting-studio";
import { applyLocale, resetLocaleForTests } from "./i18n";

const count = (html: string, needle: string) => html.split(needle).length - 1;

function emptyDesk(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MeetingStudio />
    </MemoryRouter>,
  );
}

afterEach(() => resetLocaleForTests());

describe("the empty Meeting desk", () => {
  it("draws the character once, in the main pane", () => {
    const html = emptyDesk();
    expect(count(html, 'data-testid="chat-mascot"')).toBe(1);
    const list = html.slice(html.indexOf('data-testid="meeting-list"'));
    const pane = list.slice(list.indexOf("</aside>"));
    expect(list.slice(0, list.indexOf("</aside>"))).not.toContain("chat-mascot");
    expect(pane).toContain('data-testid="chat-mascot"');
  });

  it("says what to do once, and keeps the list's own line", () => {
    applyLocale("en");
    const html = emptyDesk();
    expect(count(html, "Create one, add the recording, and the minutes follow.")).toBe(1);
    expect(html).toContain('data-testid="meeting-empty"');
    expect(html).toContain("No meetings yet.");
  });

  it("does the same in Bahasa Indonesia", () => {
    applyLocale("id");
    const html = emptyDesk();
    expect(count(html, 'data-testid="chat-mascot"')).toBe(1);
    expect(count(html, "Buat satu, tambahkan rekamannya, dan notulen menyusul.")).toBe(1);
    expect(html).toContain("Belum ada rapat.");
  });
});
