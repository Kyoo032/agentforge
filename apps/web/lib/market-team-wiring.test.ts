/**
 * `apps/web` runs vitest without a DOM, so the studio and the team panel
 * cannot be rendered here. These read the component source instead and pin the
 * wiring a drive depends on: the depth control beside the language select in
 * both placements of the header, the depth riding along in the request body,
 * the control going inert on a desk with no analysts, and the panel's testids.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../locales/en/market.json";
import id from "../locales/id/market.json";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");

const studio = read("../components/market-studio.tsx");
const panel = read("../components/market-team-panel.tsx");
const view = read("../components/market-briefing-view.tsx");
const client = read("../lib/market-client.ts");

describe("market depth control wiring", () => {
  it("mounts one segmented control with both depths", () => {
    expect(studio).toContain('data-testid="market-depth"');
    expect(studio).toContain("data-testid={`market-depth-${option}`}");
    expect(studio).toContain("MARKET_DEPTHS.map((option) => (");
    // The track hugs its two buttons instead of stretching down the flex row.
    expect(studio).toContain("inline-flex w-fit self-start rounded-md");
    expect(studio).toContain('aria-label={t("market.depth.aria")}');
    expect(studio).toContain('{t("market.depth.label")}');
    expect(studio).toContain("{t(`market.depth.${option}`)}");
    // The wire values stay quick/team however the catalog renames the labels.
    expect(studio).toContain("data-testid={`market-depth-${option}`}");
    // Written once so the two placements cannot drift apart.
    expect(studio.split("const depthControl = (")).toHaveLength(2);
    expect(studio.split('data-testid="market-depth"')).toHaveLength(2);
  });

  it("puts the control beside the language select and in the empty state too", () => {
    expect(studio.split("{depthControl}")).toHaveLength(3);
    expect(studio).toMatch(/<\/select>\s*\{depthControl\}\s*\{specialistPicker\}/);
    expect(studio).toMatch(/\{specialistPicker\}\s*\{depthControl\}/);
  });

  it("starts at quick, whatever the option is called", () => {
    expect(studio).toContain("useState<MarketDepth>(DEFAULT_MARKET_DEPTH)");
    expect(client).toContain("DEFAULT_MARKET_DEPTH");
  });

  it("disables team and explains itself on a desk with no analysts", () => {
    expect(studio).toContain("const teamReady = teamAvailable(specialist);");
    expect(studio).toContain('disabled={locked || (option === "team" && !teamReady)}');
    expect(studio).toContain('data-testid={teamReady ? "market-depth-hint" : "market-depth-unavailable"}');
    expect(studio).toContain('t("market.depth.unavailable")');
  });

  it("resets the depth to quick when the rail moves to such a desk", () => {
    expect(studio).toContain("setDepth((current) => nextDepth({ depth: current, specialist }));");
    expect(studio).toContain("const requestDepth = nextDepth({ depth, specialist });");
  });

  it("sends the clamped depth in the briefing request body", () => {
    const body = studio.slice(studio.indexOf("const body: MarketWatchRequest = {"));
    expect(body.slice(0, body.indexOf("};"))).toContain("depth: requestDepth,");
    expect(studio).toContain('job.run("/api/v1/market/stream", body)');
  });

  it("relabels the streamed team phases without touching the job stream's own state", () => {
    expect(studio).toContain("const teamProgress = localizeMarketProgress(job.progress, labeled);");
    expect(studio).toContain("progress={teamProgress}");
    expect(studio).toContain('testId="market-progress"');
    expect(client).toContain('export const MARKET_TEAM_PHASES = ["analysts", "debate", "risk", "synthesis"] as const;');
    // A copy, never an in-place relabel of the reducer's phases.
    expect(client).toContain("return changed ? { ...progress, phases } : progress;");
  });
});

describe("market team panel wiring", () => {
  it("renders under the briefing only when the run carried a team", () => {
    expect(view).toContain("{briefing.team ? (");
    expect(view).toContain("<MarketTeamPanel");
    expect(view).toContain("team={briefing.team}");
    expect(view).toContain("language={briefing.language}");
    expect(view).toContain("testIdPrefix={`${testIdPrefix}-team`}");
    expect(view).toContain('import { MarketTeamPanel } from "@/components/market-team-panel"');
    // The panel sits between the narrative and the packet tables.
    expect(view.indexOf("{briefing.team ? (")).toBeGreaterThan(view.indexOf("briefing.sections.map"));
    expect(view.indexOf("{briefing.team ? (")).toBeLessThan(
      view.indexOf('<h3 className={H3}>{t("market.briefing.watchlist")}</h3>'),
    );
  });

  it("carries the four analyst cards, both debate columns and the three risk lenses", () => {
    expect(panel).toContain("testId={`${testIdPrefix}-analyst-${note.analyst}`}");
    expect(panel).toContain("testId={`${testIdPrefix}-bull`}");
    expect(panel).toContain("testId={`${testIdPrefix}-bear`}");
    expect(panel).toContain("testId={`${testIdPrefix}-risk-${lens.lens}`}");
    expect(panel).toContain("data-testid={`${testIdPrefix}-toggle`}");
    // Each card puts the id the parent handed it on its own element.
    expect(panel).toContain("data-testid={testId}");
    // Core order, not whatever order the host finished the calls in.
    expect(panel).toContain("MARKET_ANALYSTS.map((analyst: MarketAnalyst) =>");
  });

  it("is collapsible and starts closed", () => {
    expect(panel).toContain("const [open, setOpen] = useState(false);");
    expect(panel).toContain("aria-expanded={open}");
    expect(panel).toContain('t("market.team.hide")');
    expect(panel).toContain('t("market.team.show")');
  });

  it("renders every model string as plain text", () => {
    expect(panel).not.toContain("dangerouslySetInnerHTML");
    expect(panel).not.toContain("FormattedText");
    expect(panel).not.toContain("innerHTML");
  });
});

describe("market team catalog", () => {
  const catalogs = [
    ["en", en as unknown as Record<string, Record<string, unknown>>],
    ["id", id as unknown as Record<string, Record<string, unknown>>],
  ] as const;

  it("names the depth control and the four team phases in both locales", () => {
    for (const [locale, catalog] of catalogs) {
      for (const key of ["label", "aria", "quick", "team", "hint", "unavailable"]) {
        expect(String(catalog.depth[key] ?? "").trim().length, `${locale}: market.depth.${key}`).toBeGreaterThan(0);
      }
      for (const phase of ["analysts", "debate", "risk", "synthesis"]) {
        expect(
          String(catalog.progress[phase] ?? "").trim().length,
          `${locale}: market.progress.${phase}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("writes the depth and team copy in real Indonesian, not English", () => {
    // The control names what runs, not how long it takes: "Quick / Team" said
    // nothing about analysts, so the two options are the two staffings.
    expect(en.depth.label).toBe("Analysis");
    expect(id.depth.label).toBe("Analisis");
    expect(en.depth.quick).toBe("Single analyst");
    expect(id.depth.quick).toBe("Analis tunggal");
    expect(en.depth.team).toBe("Analyst team");
    expect(id.depth.team).toBe("Tim analis");
    expect(en.depth.hint.startsWith("Analyst team runs")).toBe(true);
    expect(id.depth.hint.startsWith("Tim analis menjalankan")).toBe(true);
    expect(en.team.title).toBe("Analyst team");
    expect(id.team.title).toBe("Tim analis");
    expect(en.team.bull).toBe("Bull case");
    expect(id.team.bull).toBe("Kasus bullish");
    expect(en.team.bear).toBe("Bear case");
    expect(id.team.bear).toBe("Kasus bearish");
    expect(en.team.risk).toBe("Risk read");
    // Core headed the synthesis section "Pembacaan risiko"; the panel must not invent a second wording.
    expect(id.team.risk).toBe("Pembacaan risiko");
    expect(id.team.lenses.conservative).toBe("Konservatif");
    expect(id.team.analysts.fundamentals).toBe("Fundamental");
    expect(id.team.confidence.high).toBe("Keyakinan tinggi");
    expect(id.progress.synthesis).toBe("Menulis briefing");
  });
});
