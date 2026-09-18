import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  MARKET_SPECIALISTS,
  RISK_LENSES,
  teamSectionHeadings,
} from "@agentforge/core/market";
import { specialistHint, specialistLabel } from "./market-specialist";
import en from "../locales/en/market.json";
import id from "../locales/id/market.json";

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

type Catalog = {
  studio: Record<string, string>;
  specialists: Record<string, { label: string; hint: string }>;
  depth: Record<string, string>;
  team: {
    analysts: Record<string, string>;
    lenses: Record<string, string>;
    confidence: Record<string, string>;
  } & Record<string, unknown>;
  progress: Record<string, string>;
};

const catalogs: ReadonlyArray<readonly [string, Catalog]> = [
  ["en", en as unknown as Catalog],
  ["id", id as unknown as Catalog],
];

describe("market locale catalogs", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keysOf(id).sort()).toEqual(keysOf(en).sort());
  });

  it("names every Market agent in both locales", () => {
    for (const [locale, catalog] of catalogs) {
      for (const specialist of MARKET_SPECIALISTS) {
        const entry = catalog.specialists[specialist];
        expect(entry, `${locale}: market.specialists.${specialist}`).toBeTruthy();
        expect(entry.label.trim().length, `${locale}: ${specialist}.label`).toBeGreaterThan(0);
        expect(entry.hint.trim().length, `${locale}: ${specialist}.hint`).toBeGreaterThan(0);
      }
    }
  });

  it("carries no agent copy for an id the core enum does not ship", () => {
    const known = new Set<string>(MARKET_SPECIALISTS);
    for (const [locale, catalog] of catalogs) {
      for (const key of Object.keys(catalog.specialists)) {
        expect(known.has(key), `${locale}: stale market.specialists.${key}`).toBe(true);
      }
    }
  });

  it("keeps the picker chrome translated and the placeholder intact", () => {
    expect(en.studio.specialistLabel).toBe("Specialist");
    expect(id.studio.specialistLabel).toBe("Spesialis");
    expect(en.studio.specialistAria.trim().length).toBeGreaterThan(0);
    expect(id.studio.specialistAria.trim().length).toBeGreaterThan(0);
    expect(en.studio.specialistStarter).toContain("{label}");
    expect(id.studio.specialistStarter).toContain("{label}");
    expect(id.studio.specialistStarter).toMatch(/daftar awal/);
  });

  it("translates the Indonesian agent names rather than copying English", () => {
    expect(id.specialists.gold.label).toBe("Emas & Mineral");
    expect(id.specialists.crypto.label).toBe("Kripto");
    expect(id.specialists.saham.label).toBe("Saham");
    expect(en.specialists.gold.label).toBe("Gold & Minerals");
  });

  it("keeps the renamed gold and equities desks word for word with the core meta", () => {
    // The gold desk widened from gold to the whole mineral complex, and the
    // equities desk from IDX-only to any exchange; the catalog and the fallback
    // behind it must not disagree about what either is called.
    for (const [locale, catalog] of catalogs) {
      const loc = locale as "en" | "id";
      for (const specialist of ["gold", "saham"] as const) {
        expect(catalog.specialists[specialist].label, `${locale}: ${specialist}.label`).toBe(
          specialistLabel(specialist, loc),
        );
        expect(catalog.specialists[specialist].hint, `${locale}: ${specialist}.hint`).toBe(
          specialistHint(specialist, loc),
        );
      }
    }
  });

  it("names every depth, analyst, lens and confidence level in both locales", () => {
    for (const [locale, catalog] of catalogs) {
      for (const depth of MARKET_DEPTHS) {
        expect(catalog.depth[depth]?.trim().length, `${locale}: market.depth.${depth}`).toBeGreaterThan(0);
      }
      for (const analyst of MARKET_ANALYSTS) {
        expect(catalog.team.analysts[analyst]?.trim().length, `${locale}: market.team.analysts.${analyst}`).toBeGreaterThan(0);
      }
      for (const lens of RISK_LENSES) {
        expect(catalog.team.lenses[lens]?.trim().length, `${locale}: market.team.lenses.${lens}`).toBeGreaterThan(0);
      }
      for (const level of CONFIDENCE_LEVELS) {
        expect(catalog.team.confidence[level]?.trim().length, `${locale}: market.team.confidence.${level}`).toBeGreaterThan(0);
      }
      for (const phase of ["analysts", "debate", "risk", "synthesis"]) {
        expect(catalog.progress[phase]?.trim().length, `${locale}: market.progress.${phase}`).toBeGreaterThan(0);
      }
    }
  });

  it("heads the team panel with the same words the synthesis heads its sections", () => {
    // The panel labels the same four blocks the briefing already wrote under
    // core's own headings. Two wordings for one block is a bug the reader sees.
    const blocks = ["notes", "bull", "bear", "risk"] as const;
    for (const [locale, catalog] of catalogs) {
      const headings = teamSectionHeadings(locale as "en" | "id");
      blocks.forEach((block, index) => {
        expect(catalog.team[block], `${locale}: market.team.${block}`).toBe(headings[index]);
      });
    }
  });

  it("carries no team copy for an analyst the core enum does not ship", () => {
    const known = new Set<string>(MARKET_ANALYSTS);
    for (const [locale, catalog] of catalogs) {
      for (const key of Object.keys(catalog.team.analysts)) {
        expect(known.has(key), `${locale}: stale market.team.analysts.${key}`).toBe(true);
      }
    }
  });

  it("names the source badge in both locales", () => {
    expect(en.studio.sourcesLabel).toBe("Sources");
    expect(id.studio.sourcesLabel).toBe("Sumber");
    expect(en.studio.sourcesComputed).toBe("Computed on device");
    expect(id.studio.sourcesComputed).toBe("Dihitung di perangkat");
  });
});
