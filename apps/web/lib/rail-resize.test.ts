/**
 * The rail's resize strip has to be the outermost thing on the aside's right
 * edge. The owner's report (2026-09-17) was that it is "hard to be pressed,
 * because it's in the same section with scroll": on /market three things stacked
 * at the same x — the nav's scrollbar, the specialist sub-list's scrollbar and
 * the `rail-resize` separator.
 *
 * The rail is JSX and this package's vitest run is node-only, so the contract is
 * pinned against the sources: the handle renders as a sibling of the scrolling
 * `<nav>`, it is absolutely positioned on the aside's edge above any scrollbar,
 * and both scrolling boxes inset their scrollbar with a margin (padding cannot —
 * a scrollbar is laid out inside the border box and outside the padding box).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RAIL_WIDTH, RAIL_WIDTH_KEY, clampPanelWidth } from "./panel-width";
import en from "../locales/en/rail.json";
import id from "../locales/id/rail.json";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const appRail = source("components/app-rail.tsx");
const handle = source("components/panel-resize-handle.tsx");
/* The sub-list chrome is shared by Market's desks and Finance's tasks. */
const specialists = source("components/rail-submenu.tsx");

/** The `<nav>` element's own markup, opening tag through `</nav>`. */
function navMarkup(): string {
  const open = appRail.indexOf("<nav ");
  const close = appRail.indexOf("</nav>");
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return appRail.slice(open, close);
}

describe("rail resize handle placement", () => {
  it("renders outside the scrolling nav, as a sibling on the aside", () => {
    expect(appRail).toContain("<PanelResizeHandle");
    // The handle must not be inside the box that scrolls, or the scrollbar wins the pointer.
    expect(navMarkup()).not.toContain("PanelResizeHandle");
    // ...and it is emitted after `</nav>`, still inside the `<aside>`.
    expect(appRail.indexOf("<PanelResizeHandle")).toBeGreaterThan(appRail.indexOf("</nav>"));
    expect(appRail.indexOf("<PanelResizeHandle")).toBeLessThan(appRail.indexOf("</aside>"));
  });

  it("pins the aside as the positioning context for it", () => {
    const aside = appRail.slice(appRail.indexOf("<aside"), appRail.indexOf("<nav "));
    expect(aside).toContain("relative");
  });

  it("carries the testid and the i18n label the harness drives", () => {
    expect(appRail).toContain('testId="rail-resize"');
    expect(appRail).toContain('label={t("rail.resize")}');
    expect(en.resize.length).toBeGreaterThan(0);
    expect(id.resize.length).toBeGreaterThan(0);
    expect(id.resize).not.toBe(en.resize);
  });

  it("is an 8px strip on the edge, above any scrollbar, with a 2px lit line", () => {
    expect(handle).toContain("absolute inset-y-0 right-0");
    expect(handle).toContain("z-10");
    // 8px hit area (`w-2`), 2px visual line (`w-0.5`) centred inside it.
    expect(handle).toContain("w-2 cursor-col-resize");
    expect(handle).toContain("w-0.5 -translate-x-1/2");
    expect(handle).not.toContain("w-1.5 cursor-col-resize");
  });

  it("shows itself with --accent on hover, focus and drag", () => {
    expect(handle).toContain("group-hover:bg-[color-mix(in_srgb,var(--accent)_70%,transparent)]");
    expect(handle).toContain("group-focus-visible:bg-[var(--accent)]");
    expect(handle).toContain('data-dragging={dragging ? "true" : "false"}');
    expect(handle).toContain('const LINE_LIT = "bg-[var(--accent)]"');
  });

  it("keeps the separator semantics and the keyboard resize", () => {
    expect(handle).toContain('role="separator"');
    expect(handle).toContain('aria-orientation="vertical"');
    expect(handle).toContain("aria-valuenow={Math.round(width)}");
    expect(handle).toContain("tabIndex={0}");
    expect(handle).toContain('if (event.key === "ArrowLeft")');
    expect(handle).toContain('if (event.key === "ArrowRight")');
  });
});

describe("rail scrollbars stay clear of the handle", () => {
  it("insets the scrolling nav with a margin, not padding", () => {
    const nav = navMarkup();
    expect(nav).toContain("overflow-y-auto");
    // `mr-2` = 8px, exactly the handle's hit area, so the 10px scrollbar ends
    // where the strip begins instead of underneath it.
    expect(nav).toContain("mr-2");
    expect(nav).toContain("px-2");
  });

  it("parks the specialist sub-list's scrollbar inside the branch", () => {
    expect(specialists).toContain("mr-1 overflow-y-auto");
    expect(specialists).not.toContain("linear-gradient");
  });

  it("leaves the collapsed rail and its toggles alone", () => {
    // No handle at all while collapsed: 68px has nothing to drag.
    expect(/\{collapsed \? null : \(\s*<PanelResizeHandle/.test(appRail)).toBe(true);
    expect(appRail).toContain('data-testid={collapsed ? "rail-expand" : "rail-collapse"}');
    expect(appRail).toContain("width: collapsed ? RAIL_WIDTH.collapsed : railWidth");
    expect(RAIL_WIDTH.collapsed).toBe(68);
  });

  it("keeps the persisted width wired through the same key and clamp", () => {
    expect(/usePanelWidth\(\s*RAIL_WIDTH_KEY,/.test(appRail)).toBe(true);
    expect(appRail).toContain("onWidth={setRailWidth}");
    expect(RAIL_WIDTH_KEY).toBe("agentforge-rail-width");
    expect(RAIL_WIDTH.min).toBe(168);
    expect(RAIL_WIDTH.default).toBe(232);
    expect(clampPanelWidth(RAIL_WIDTH.min - 40, RAIL_WIDTH.min, RAIL_WIDTH.max)).toBe(RAIL_WIDTH.min);
    expect(clampPanelWidth(RAIL_WIDTH.max + 40, RAIL_WIDTH.min, RAIL_WIDTH.max)).toBe(RAIL_WIDTH.max);
  });

  it("leaves room for a row at the narrowest rail: nothing can overflow sideways", () => {
    // 168 rail − 8 (nav margin) − 16 (nav px-2) − 10 (scrollbar) = 134px of row.
    const row = RAIL_WIDTH.min - 8 - 16 - 10;
    expect(row).toBeGreaterThan(0);
    // The branch indents 22 + 8 + 1px hairline, then insets its own scrollbar.
    expect(row - 31 - 4 - 10).toBeGreaterThan(0);
    // Every row truncates rather than pushing the box wider.
    expect(specialists).toContain('<span className="truncate">{row.label}</span>');
  });
});
