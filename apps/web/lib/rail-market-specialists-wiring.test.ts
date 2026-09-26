/**
 * The Market agents sit under the Market rail entry the way the chat sessions
 * sit under Chat. That block is JSX and this package's vitest run is node-only,
 * so the contract is pinned against the sources: one row per agent, the testids
 * the harness drives, the chevron, and the collapsed rail staying an icon column.
 *
 * The chrome itself now lives in `rail-submenu`, shared with Finance, so the
 * rules that were Market's are asserted there and the Market module is checked
 * for what only Market owns: its ids, its route, its labels and its testids.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_SPECIALIST, MARKET_SPECIALISTS } from "@agentforge/core/market";
import en from "../locales/en/rail.json";
import id from "../locales/id/rail.json";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const block = source("components/rail-market-specialists.tsx");
const shared = source("components/rail-submenu.tsx");
const appRail = source("components/app-rail.tsx");
const prefs = source("lib/rail-prefs.ts");

describe("rail market specialists block", () => {
  it("renders one row per agent, in the core order, keyed off the enum", () => {
    expect(block).toContain("MARKET_SPECIALISTS.map((id) => ({");
    expect(block).toContain("rowTestId={(id) => `rail-market-specialist-${id}`}");
    expect(shared).toContain("data-testid={rowTestId(row.id)}");
    // The row testids are templated, so the enum is what fixes the set.
    expect(MARKET_SPECIALISTS[0]).toBe("saham");
    expect([...MARKET_SPECIALISTS]).toContain("crypto");
    expect([...MARKET_SPECIALISTS]).toContain("gold");
    expect([...MARKET_SPECIALISTS]).toContain("elliott-wave");
    expect(MARKET_SPECIALISTS).toHaveLength(11);
  });

  it("links each row to its desk and marks the open one", () => {
    expect(block).toContain('export const MARKET_PATH = "/market"');
    expect(block).toContain("return `${MARKET_PATH}?specialist=${encodeURIComponent(id)}`;");
    expect(block).toContain("href: specialistHref(id),");
    expect(block).toContain("onMode={pathname === MARKET_PATH}");
    expect(shared).toContain("const active = onMode && currentId === row.id;");
    expect(shared).toContain('aria-current={active ? "true" : undefined}');
  });

  it("defaults an absent or unknown query value to the core default agent", () => {
    expect(block).toContain('specialistFromParam(searchParams.get("specialist"))');
    expect(block).toContain("return isMarketSpecialist(value) ? value : DEFAULT_MARKET_SPECIALIST;");
    expect(DEFAULT_MARKET_SPECIALIST).toBe("saham");
  });

  it("names each agent from the catalog with the core meta behind it", () => {
    expect(block).toContain("labeled(`market.specialists.${id}.label`, specialistLabel(id, locale))");
    expect(block).toContain("labeled(`market.specialists.${id}.hint`, specialistHint(id, locale))");
  });

  it("labels the group and keeps the session rows' indent and type scale", () => {
    expect(block).toContain('testId="rail-market-specialists"');
    expect(shared).toContain('role="group"');
    expect(shared).toContain("aria-label={ariaLabel}");
    expect(block).toContain('ariaLabel={t("rail.marketSpecialistsAria")}');
  });

  it("keeps the session rows' height, scale and muted colour, one notch left", () => {
    const rows = source("components/rail-recent-threads.tsx");
    // Same row metrics as a session row; only the horizontal padding differs,
    // because the guide rail supplies the indent here.
    for (const fragment of ["h-7", "text-xs", "tracking-[var(--track)]", "text-[var(--rail-text-2)]", "min-w-0 flex-1"]) {
      expect(shared, fragment).toContain(fragment);
      expect(rows, fragment).toContain(fragment);
    }
    expect(shared).toContain("items-center rounded-md px-1.5 text-xs");
    expect(shared).not.toContain("items-center rounded-md px-2 text-xs");
    // No icons on a sub-row; the icon column belongs to the job modes.
    expect(shared).not.toContain("RailIcon");
    expect(block).not.toContain("RailIcon");
  });

  it("marks the open desk unmistakably inside the sub-list", () => {
    // The rail is dark chrome in both themes, so its rows read from `--rail-*`.
    expect(shared).toContain("`select-row ${ROW_BASE} shadow-elev-1 font-medium text-[var(--rail-active-text)] [background-image:var(--grad-soft)]`");
    expect(shared).toContain(
      "`wash ${ROW_BASE} text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]`",
    );
  });

  it("nests the block on a guide rail so it does not blend into the next job mode", () => {
    expect(shared).toContain('export const BRANCH = "ml-[22px] mt-1 mb-2 border-l border-[var(--rail-line)] pl-2"');
    expect(shared).toContain("<div className={BRANCH} data-testid={branchTestId}>");
    expect(block).toContain('branchTestId="rail-market-specialists-branch"');
  });

  it("scrolls overflow without a gradient mask", () => {
    expect(shared).not.toContain("linear-gradient");
    expect(shared).toContain("const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);");
    expect(shared).toContain("const observer = new ResizeObserver(measure);");
    expect(shared).toContain("observer.observe(node);");
    expect(shared).toContain('className="mr-1 overflow-y-auto"');
    expect(shared).toContain("style={{ maxHeight: listMaxHeight(rows.length) }}");
  });

  it("is open exactly while the route is Market, with no closed frame first", () => {
    // Derived from the route, not an effect reading a store, so `/market` paints
    // expanded; selecting any other mode minimises it on the same render.
    expect(block).toContain("return useRailSubmenu(MARKET_PATH);");
    const hook = shared.slice(shared.indexOf("export function useRailSubmenu"));
    const hookBody = hook.slice(0, hook.indexOf("export function RailSubmenuToggle"));
    expect(hookBody).toContain("const onMode = pathname === path;");
    expect(hookBody).toContain("open: onMode && !closedOnMode,");
    expect(hookBody).toContain("enabled: onMode,");
    // The chevron's close is dropped on leaving the mode, so the next visit re-opens.
    expect(hookBody).toContain("if (!onMode) {");
    expect(hookBody).toContain("setClosedOnMode(false);");
    expect(hookBody).toContain("}, [onMode]);");
    expect(hookBody).toContain("toggle: () => setClosedOnMode((was) => !was),");
  });

  it("persists nothing: the route is the whole state", () => {
    for (const file of [block, shared]) {
      expect(file).not.toContain("rail-prefs");
      expect(file).not.toContain("localStorage");
      expect(file).not.toContain("RailMarketSpecialistsOpen");
    }
    expect(prefs).not.toContain("RAIL_MARKET_SPECIALISTS_KEY");
    expect(prefs).not.toContain("agentforge-rail-market-specialists");
    expect(prefs).not.toContain("MarketSpecialists");
  });

  it("reports collapsed and sits inert off Market rather than dead-clicking", () => {
    expect(shared).toContain("enabled = true,");
    expect(shared).toContain("disabled={!enabled}");
    expect(block).toContain("enabled={enabled}");
    expect(appRail).toContain("enabled={marketSpecialists.enabled}");
  });

  it("scrolls with the viewport instead of pinning eleven rows on a laptop", () => {
    expect(shared).toContain("export const ROW_PX = 28");
    expect(shared).toContain("export const MIN_ROWS = 4");
    expect(shared).toContain("export const RAIL_RESERVED_PX = 700");
    expect(shared).toContain(
      "return `clamp(${MIN_ROWS * ROW_PX}px, calc(100vh - ${RAIL_RESERVED_PX}px), ${rows * ROW_PX}px)`;",
    );
    expect(shared).toContain("style={{ maxHeight: listMaxHeight(rows.length) }}");
    expect(shared).toContain("overflow-y-auto");
    // The floor must stay under the ceiling, or the clamp inverts.
    expect(4 * 28).toBeLessThan(MARKET_SPECIALISTS.length * 28);
  });

  it("keeps the open desk in view when the block has to scroll", () => {
    expect(shared).toContain("const listRef = useRef<HTMLDivElement | null>(null);");
    expect(shared).toContain(
      'listRef.current?.querySelector(\'[aria-current="true"]\')?.scrollIntoView({ block: "nearest" });',
    );
    expect(shared).toContain("}, [onMode, currentId]);");
  });

  it("only shows and hides: the chevron never navigates", () => {
    expect(block).toContain('testId="rail-market-specialists-toggle"');
    expect(shared).toContain("aria-expanded={open}");
    expect(shared).toContain("onClick={onToggle}");
    const toggle = shared.slice(shared.indexOf("export function RailSubmenuToggle"));
    const toggleEnd = toggle.slice(0, toggle.indexOf("export type RailSubmenuRow"));
    expect(toggleEnd).not.toContain("router.push");
    expect(toggleEnd).not.toContain("<Link");
    expect(toggleEnd).not.toContain("href");
  });
});

describe("app rail market block", () => {
  it("hangs the agents off the Market row, above the next group", () => {
    const marketBranch = appRail.indexOf('if (collapsed || (mode.id !== "market" && mode.id !== "finance"))');
    const toggle = appRail.indexOf("<RailMarketSpecialistsToggle");
    const rows = appRail.indexOf("<RailMarketSpecialists />");
    const account = appRail.indexOf("rail.groupAccount");
    expect(marketBranch).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(marketBranch);
    expect(rows).toBeGreaterThan(toggle);
    expect(account).toBeGreaterThan(rows);
  });

  it("keeps the job-mode order: Chat, its sessions, JOB MODES, then Market's agents", () => {
    const chatItem = appRail.indexOf("mode-${chatMode.href.slice(1)}");
    const sessions = appRail.indexOf("<RailRecentThreads");
    const jobModes = appRail.indexOf("rail.groupJobs");
    const specialists = appRail.indexOf("<RailMarketSpecialists />");
    expect(chatItem).toBeGreaterThan(-1);
    expect(sessions).toBeGreaterThan(chatItem);
    expect(jobModes).toBeGreaterThan(sessions);
    expect(specialists).toBeGreaterThan(jobModes);
  });

  it("renders nothing extra while the rail is collapsed", () => {
    expect(appRail).toContain('if (collapsed || (mode.id !== "market" && mode.id !== "finance")) {');
    expect(appRail).toContain("      return item;");
    expect(appRail).toContain("{marketSpecialists.open ? <RailMarketSpecialists /> : null}");
  });

  it("keeps the Market row one h-8 row like every other job mode", () => {
    // Closed, nothing renders below it: the branch, its margins and its border
    // all live inside the sub-list component, which is mounted only when open.
    expect(appRail).toContain('<div key={mode.href} className="shrink-0" data-testid="rail-market-mode">');
    expect(appRail).toContain('<div className="flex h-8 items-center gap-0.5">');
    expect(shared).toContain("<div className={BRANCH} data-testid={branchTestId}>");
    const branchInAppRail = appRail.includes("border-l border-[var(--line)]");
    expect(branchInAppRail).toBe(false);
  });

  it("stops the nav squashing rows, which is what made Market look spaced out", () => {
    // The nav is a column flex box; without `shrink-0` a rail taller than the
    // viewport shrinks bare rows but not a wrapped one, so Market read as taller.
    expect(appRail).toContain("flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm");
    expect(appRail).toContain(
      '<p className="shrink-0 px-2 pt-4 pb-1.5 text-xs font-medium tracking-normal text-[var(--rail-text-3)]">',
    );
  });
});

describe("rail locale catalog", () => {
  it("translates the specialists chrome in both locales", () => {
    expect(en.marketSpecialistsAria).toBe("Market specialists");
    expect(en.marketSpecialistsToggle).toBe("Show specialists");
    expect(en.marketSpecialistsHide).toBe("Hide specialists");
    expect(id.marketSpecialistsAria).toBe("Spesialis pasar");
    expect(id.marketSpecialistsToggle).toBe("Tampilkan spesialis");
    expect(id.marketSpecialistsHide).toBe("Sembunyikan spesialis");
  });
});
