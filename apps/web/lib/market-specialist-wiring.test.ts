/**
 * `apps/web` runs vitest without a DOM, so the studio itself cannot be
 * rendered here. These read the component source instead and pin the wiring a
 * drive depends on: the desk read off the URL, its own watchlist, the agent
 * riding along in the request body, and the agent named on the briefing.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARKET_SPECIALISTS } from "@agentforge/core/market";

const here = dirname(fileURLToPath(import.meta.url));
const studio = readFileSync(resolve(here, "../components/market-studio.tsx"), "utf8");
const client = readFileSync(resolve(here, "../lib/market-client.ts"), "utf8");

describe("market studio specialist wiring", () => {
  it("names the open desk instead of offering a second picker", () => {
    expect(studio).toContain('data-testid="market-specialist-current"');
    expect(studio).toContain('aria-label={t("market.studio.specialistAria")}');
    expect(studio).toContain('{t("market.studio.specialistLabel")}');
    expect(studio).toContain("{specialistName(specialist)}");
  });

  it("dropped the in-page select: the rail is the only way to pick an agent", () => {
    expect(studio).not.toContain('data-testid="market-specialist"');
    expect(studio).not.toContain('id="market-specialist-select"');
    expect(studio).not.toContain("data-testid={`market-specialist-${id}`}");
    expect(studio).not.toContain("{MARKET_SPECIALISTS.map((id) => (");
    expect(studio).not.toContain("onSpecialistChange");
    expect(studio).not.toContain("setSpecialist(");
  });

  it("takes the agent from the URL, validated, with the core default behind it", () => {
    expect(studio).toContain('const rawSpecialist = searchParams.get("specialist")');
    expect(studio).toContain("isMarketSpecialist(rawSpecialist)");
    expect(studio).toContain("DEFAULT_MARKET_SPECIALIST");
    expect(studio).toContain('import { usePathname, useSearchParams } from "@/lib/nav"');
    // The pane stays mounted behind the other work modes, so an off-market URL
    // must not reset the desk to the default.
    expect(studio).toContain("const onMarket = pathname === MARKET_PATH");
    expect(studio).toContain("const specialist = onMarket ? urlSpecialist : lastSpecialistRef.current");
    // The rail's rows are what fix the set; the enum is still the source of order.
    expect([...MARKET_SPECIALISTS]).toContain("elliott-wave");
    expect(MARKET_SPECIALISTS[0]).toBe("saham");
  });

  it("gives every agent its own board, stored per desk", () => {
    expect(studio).toContain('import { loadWatchlist, saveWatchlist } from "@/lib/market-watchlists"');
    expect(studio).toContain('import { useWorkspaceScope } from "@/lib/workspace-scope"');
    expect(studio).toContain("const { id: workspaceId } = useWorkspaceScope()");
    expect(studio).toContain("useState<string[]>(() => loadWatchlist(workspaceId, specialist))");
    expect(studio).toContain("setTickers(loadWatchlist(workspaceId, specialist));");
    expect(studio).toContain("saveWatchlist(workspaceId, specialist, next);");
  });

  it("renders the provenance badge under the hint, in the one mounted picker", () => {
    expect(studio).toContain('data-testid="market-specialist-sources"');
    expect(studio).toContain("{specialistSources}");
    expect(studio).toContain('prefix: t("market.studio.sourcesLabel")');
    expect(studio).toContain('computedLabel: t("market.studio.sourcesComputed")');
    // The hint comes first, and the picker is written once for both placements.
    expect(studio.indexOf('data-testid="market-specialist-hint"')).toBeLessThan(
      studio.indexOf('data-testid="market-specialist-sources"'),
    );
    expect(studio.split('data-testid="market-specialist-sources"')).toHaveLength(2);
    expect(studio.split("const specialistPicker = (")).toHaveLength(2);
  });

  it("names each agent from the catalog with the core meta behind it", () => {
    expect(studio).toContain("labeled(`market.specialists.${id}.label`, specialistLabel(id, uiLocale))");
    expect(studio).toContain("labeled(`market.specialists.${id}.hint`, specialistHint(id, uiLocale))");
  });

  it("swaps an untouched prompt on both the agent and the language axis", () => {
    expect(studio).toContain("setPrompt(nextPrompt({ prompt, specialist, language: next }))");
    // The agent axis now arrives through the URL, so the swap rides the effect.
    expect(studio).toContain("setPrompt((current) => nextPrompt({ prompt: current, specialist, language }));");
    expect(studio).toContain("const movedDesk = lastSpecialistRef.current !== specialist;");
    expect(studio).toContain("setPrompt(defaultWatchPrompt(specialist, language))");
    expect(studio).not.toContain("DEFAULT_WATCH_PROMPT_ID");
    expect(studio).not.toContain("DEFAULT_WATCH_PROMPT_EN");
  });

  it("offers the agent's own starter watchlist", () => {
    expect(studio).toContain('data-testid="market-specialist-starter"');
    expect(studio).toContain("changeTickers(specialistStarterTickers(specialist))");
    expect(studio).toContain('t("market.studio.specialistStarter", { label: specialistName(specialist) })');
  });

  it("sends the chosen agent in the briefing request body", () => {
    const body = studio.slice(studio.indexOf("const body: MarketWatchRequest = {"));
    expect(body.slice(0, body.indexOf("};"))).toContain("specialist,");
    expect(studio).toContain('job.run("/api/v1/market/stream", body)');
  });

  it("reads the agent back off the finished briefing", () => {
    expect(studio).toContain('data-testid="market-briefing-specialist"');
    expect(studio).toContain("isMarketSpecialist(result.briefing.specialist) ? result.briefing.specialist : specialist");
  });

  it("keeps the rewrite route on the briefing's own agent", () => {
    // /regenerate takes the whole briefing, which already carries `specialist`.
    expect(client).toContain("briefing: input.briefing,");
    expect(client).toContain("specialistStarterTickers");
  });
});
