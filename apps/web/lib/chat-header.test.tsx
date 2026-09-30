/**
 * The Chat header: one row at every width, its chips beside the title while they fit and in one
 * "Chat details" menu when they do not.
 *
 * Node has no layout, so what a browser measures is handed to `ChatHeaderView` as a mode and an
 * open flag (the decision itself is `chat-header-fit.test.ts`). This holds the markup in each mode
 * with the real chips inside it: every chip once, the button's accessible contract, and the CSS
 * that draws the two modes. The widths, the keyboard sequence and the focus are driven live:
 * `.cursor/skills/verify-agentforge/features/chat.md`, "Header".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatAccountChip } from "@/components/chat-account-chip";
import { ChatContextChip } from "@/components/chat-context-chip";
import { ChatHeaderView } from "@/components/chat-header";
import { ChatUsageChip } from "@/components/chat-usage-chip";
import type { HeaderMode } from "./chat-header-fit";
import { applyLocale, resetLocaleForTests } from "./i18n";
import { SessionFixture, type SessionSnapshot } from "./session";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8").replace(/\r\n/g, "\n");
const headerCss = read("components", "chat-header.css");
const headerSource = read("components", "chat-header.tsx");
const fitSource = read("lib", "use-chat-header-fit.ts");
const sessionSource = read("components", "chat-session.tsx");

const SIGNED_IN: SessionSnapshot = {
  status: "signed-in",
  identity: { userId: "usr_1", orgId: "org_1", tenantId: "tnt_1", expiresAt: 0 },
  reason: null,
};

/** A header holding the real three chips, in the mode and open state given. */
function markup(mode: HeaderMode, open = false): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SessionFixture value={SIGNED_IN}>
        <ChatHeaderView title="Chat" compact={false} mode={mode} open={open} panelId="header-panel">
          <ChatContextChip usedTokens={1200} contextLength={1_050_000} />
          <ChatUsageChip />
          <ChatAccountChip />
        </ChatHeaderView>
      </SessionFixture>
    </MemoryRouter>,
  );
}

/** How many times `needle` appears in `html`. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The declarations of the first rule whose selector is exactly `selector`, at any depth. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(headerCss);
  expect(match, `${selector} must have a rule in chat-header.css`).not.toBeNull();
  return match?.[1] ?? "";
}

beforeEach(() => applyLocale("en"));
afterEach(() => resetLocaleForTests());

describe("every chip is mounted once, in every mode", () => {
  for (const [mode, open] of [
    ["inline", false],
    ["menu", false],
    ["menu", true],
  ] as const) {
    it(`renders each chip exactly once when ${mode}${open ? " and open" : ""}`, () => {
      const html = markup(mode, open);
      expect(count(html, 'data-testid="chat-context"')).toBe(1);
      expect(count(html, 'data-testid="chat-usage"')).toBe(1);
      expect(count(html, 'data-testid="chat-account"')).toBe(1);
    });
  }

  it("has one place the chips render, so a mode change moves them and never mounts a second set", () => {
    const provider = "<ChatHeaderLayoutContext.Provider value={layout}>{children}</ChatHeaderLayoutContext.Provider>";
    expect(count(headerSource, provider)).toBe(1);
    // ChatSession hands the chips over as children of the header rather than rendering them itself.
    const body = sessionSource.slice(sessionSource.indexOf("<ChatHeader "), sessionSource.indexOf("</ChatHeader>"));
    expect(count(body, "<ChatContextChip")).toBe(1);
    expect(count(body, "<ChatUsageChip")).toBe(1);
    expect(count(body, "<ChatAccountChip")).toBe(1);
    expect(sessionSource).not.toContain("chat-header-controls");
  });
});

describe("inline mode", () => {
  it("has the chips beside the title and no menu button", () => {
    const html = markup("inline");
    expect(html).toContain('data-testid="chat-header"');
    expect(html).toContain('data-mode="inline"');
    expect(html).toContain('data-open="false"');
    expect(html).not.toContain('data-testid="chat-header-menu"');
    expect(html).not.toContain('role="dialog"');
  });

  it("leaves a chip's own popover as it was", () => {
    const html = markup("inline");
    expect(html).toMatch(/data-testid="chat-context"[^>]*aria-haspopup="dialog"/);
    expect(html).toMatch(/data-testid="chat-account"[^>]*aria-haspopup="dialog"/);
  });
});

describe("menu mode", () => {
  it("shows one button that is a proper popup control, named in English", () => {
    const html = markup("menu");
    const button = /<button[^>]*data-testid="chat-header-menu"[^>]*>/.exec(html)?.[0] ?? "";
    expect(count(html, 'data-testid="chat-header-menu"')).toBe(1);
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-label="Chat details"');
    expect(button).toContain('title="Chat details"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-controls="header-panel"');
    expect(html).toContain('data-mode="menu"');
    expect(html).toContain('data-open="false"');
  });

  it("names the button in Indonesian", () => {
    applyLocale("id");
    const html = markup("menu");
    expect(html).toContain('aria-label="Detail obrolan"');
    expect(html).toContain('Akun</button>');
  });

  it("marks the button expanded and the header open when the menu is open", () => {
    const html = markup("menu", true);
    const button = /<button[^>]*data-testid="chat-header-menu"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-expanded="true"');
    expect(html).toContain('data-open="true"');
  });

  it("makes the chips' container the labelled panel the button controls", () => {
    const html = markup("menu");
    const panel = /<div[^>]*data-testid="chat-header-controls"[^>]*>/.exec(html)?.[0] ?? "";
    expect(panel).toContain('id="header-panel"');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-label="Chat details"');
    expect(panel).toContain('tabindex="-1"');
  });

  it("presents the chips as rows: their details unfold in the row, not in a popover of their own", () => {
    const html = markup("menu");
    expect(html).not.toMatch(/data-testid="chat-context"[^>]*aria-haspopup/);
    expect(html).not.toMatch(/data-testid="chat-account"[^>]*aria-haspopup/);
    const context = read("components", "chat-context-chip.tsx");
    expect(context).toContain('className="chat-header-detail"');
    expect(context).toContain("open && !inMenu && pos");
    expect(read("components", "chat-account-chip.tsx")).toContain('? "chat-header-detail"');
  });

  it("starts a chip's details closed again whenever the header changes, by comparing epochs", () => {
    for (const file of ["chat-context-chip", "chat-account-chip"]) {
      expect(read("components", `${file}.tsx`), file).toContain("openEpoch === layout.epoch");
    }
    expect(headerSource).toContain("epoch={fit.state.epoch}");
  });

  it("has the button after nothing and before the panel, so Tab enters the panel from the button", () => {
    const html = markup("menu");
    const button = html.indexOf('data-testid="chat-header-menu"');
    expect(button).toBeGreaterThan(-1);
    expect(button).toBeLessThan(html.indexOf('data-testid="chat-header-controls"'));
  });
});

describe("what the fit hook wires", () => {
  it("closes on Escape, on a press outside and on focus leaving, and returns focus to the button", () => {
    expect(fitSource).toContain('event.key === "Escape"');
    expect(fitSource).toContain('document.addEventListener("pointerdown"');
    expect(fitSource).toContain('document.addEventListener("focusin"');
    expect(fitSource).toContain('state.focus === "button"');
    expect(fitSource).toContain("buttonRef.current?.focus()");
  });

  it("shuts the menu when a link in it is followed, or when the pane holding it is hidden", () => {
    expect(fitSource).toContain('closest("a[href]")');
    expect(fitSource).toContain('dispatch({ type: "pick" })');
    expect(fitSource).toContain("current.open && header.clientWidth === 0");
    expect(headerSource).toContain("onClick={menu && open ? onPanelClick : undefined}");
  });

  it("takes the shut chips out of the tab order and out of what is read aloud", () => {
    expect(headerSource).toContain("inert={menu && !open ? true : undefined}");
  });

  it("observes the header, the title and the chips, and the chips' children", () => {
    for (const fragment of [
      "resize?.observe(header)",
      "resize?.observe(title)",
      "resize?.observe(controls)",
      "mutation?.observe(controls, { childList: true })",
    ]) {
      expect(fitSource, fragment).toContain(fragment);
    }
  });
});

describe("the CSS that draws the two modes", () => {
  it("is one non-wrapping row, never a fixed height", () => {
    const header = rule(".chat-header");
    expect(header).toContain("flex-wrap: nowrap");
    expect(header).toContain("min-height: 3.5rem");
    expect(header).not.toMatch(/(^|[\s;])height:/);
    expect(header).toContain("position: relative");
  });

  it("gives the menu button a 40px tap target and a visible focus ring", () => {
    const button = rule(".chat-header-menu-btn");
    expect(button).toContain("min-width: 2.5rem");
    expect(button).toContain("min-height: 2.5rem");
    expect(rule(".chat-header-menu-btn:focus-visible")).toContain("outline: 2px solid var(--accent)");
  });

  it("keeps the shut menu's chips laid out at their natural width but unseen and out of the tab order", () => {
    const shut = rule('.chat-header[data-mode="menu"] .chat-header-controls');
    expect(shut).toContain("position: absolute");
    expect(shut).toContain("width: max-content");
    expect(shut).toContain("visibility: hidden");
    expect(shut).toContain("pointer-events: none");
  });

  it("opens the same element as a panel capped to the header's width and the viewport's height", () => {
    const open = rule('.chat-header[data-mode="menu"][data-open="true"] .chat-header-controls');
    expect(open).toContain("visibility: visible");
    expect(open).toContain("width: min(20rem, calc(100% - 2 * var(--chat-gutter)))");
    expect(open).toContain("max-height: min(32rem, calc(100dvh - 8rem))");
    expect(open).toContain("overflow-y: auto");
    expect(open).toContain("flex-direction: column");
  });

  it("makes each chip a row at least 40px tall in the open panel", () => {
    const row = rule('.chat-header[data-mode="menu"][data-open="true"] .chat-header-controls .chip');
    expect(row).toContain("min-height: 2.5rem");
    expect(row).toContain("width: 100%");
  });

  it("does not read a viewport or a container query: the fit is measured, not a breakpoint", () => {
    expect(headerCss).not.toContain("@media");
    expect(headerCss).not.toContain("@container");
    expect(headerCss).not.toContain("container-type");
  });
});
