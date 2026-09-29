/**
 * The Chat hero's key status, on the frame before the host has answered.
 *
 * `renderToStaticMarkup` runs no effects, so what it returns is exactly that first frame. It used to
 * be the needs-key copy plus a Settings button on every load, for a desk whose key is connected:
 * `gate` is null while the read is in flight, and null fell through to "Connect a key to go live".
 * The words are held in both languages; the answer itself (connected, invalid, unreachable) is
 * driven live: `.cursor/skills/verify-agentforge/features/chat.md`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ChatKeyStatus } from "@/components/chat-key-status";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function firstFrame(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ChatKeyStatus />
    </MemoryRouter>,
  );
}

afterEach(() => resetLocaleForTests());

describe("key status before the host has answered", () => {
  it.each(["en", "id"] as const)("does not tell a connected desk to connect a key (%s)", (locale) => {
    applyLocale(locale);
    const html = firstFrame();
    expect(html).not.toContain(t("chat.empty.statusNeedsKey"));
    expect(html).not.toContain('data-testid="chat-empty-settings"');
    // The pill keeps its room, so the hero does not jump when the answer lands, but is not painted
    // or read out.
    expect(html).toContain("chat-status-pill");
    expect(html).toMatch(/class="chat-status-pill[^"]*\binvisible\b/);
    expect(html).toContain('aria-hidden="true"');
    // The one door that is true whatever the answer is stays.
    expect(html).toContain('data-testid="chat-whats-this"');
  });
});

describe("the Indonesian needs-key copy", () => {
  const catalog = (locale: string): { empty: { statusNeedsKey: string } } =>
    JSON.parse(readFileSync(join(web, "locales", locale, "chat.json"), "utf8"));

  it("fits the pill at 320 px: about 5.5 px a character in a 152 px line, so 27 characters at most", () => {
    // Measured in the browser on 2026-09-29: the old copy ("Hubungkan kunci untuk mulai langsung",
    // 36 characters) wanted 197 px of a 152 px line and truncated. The English line is 24.
    const id = catalog("id").empty.statusNeedsKey;
    expect(id.length).toBeLessThanOrEqual(27);
    expect(id).not.toBe(catalog("en").empty.statusNeedsKey);
  });
});
