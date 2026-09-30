/**
 * First-run setup says nothing that the first desk cannot do. The first desk has Chat, Research,
 * Images, Videos and Presentation (`FIRST_RUN_MODES`); onboarding's hello and its example tiles name
 * only those, in both languages, and promise the tour only while it is coming.
 */
import { FIRST_RUN_MODES } from "@agentforge/core/product-modes";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { EXAMPLES, EXAMPLE_MODE, OnboardingScreen } from "@/components/onboarding-screen";
import { applyLocale, resetLocaleForTests, t } from "./i18n";
import en from "../locales/en/onboarding.json";
import id from "../locales/id/onboarding.json";

afterEach(() => {
  resetLocaleForTests();
});

const NOT_ON_A_FIRST_DESK = ["documents", "finance", "data", "market", "legal", "meeting", "music", "edit", "education"];

describe("onboarding's example tiles", () => {
  it("only offer tools a first desk has: every tile's tool is Chat or one of the first-run modes", () => {
    for (const example of EXAMPLES) {
      expect(FIRST_RUN_MODES as readonly string[], example).toContain(EXAMPLE_MODE[example]);
    }
  });

  it("do not name a tool that is not on a first desk", () => {
    for (const example of EXAMPLES) {
      expect(NOT_ON_A_FIRST_DESK, example).not.toContain(EXAMPLE_MODE[example]);
    }
  });

  it("have a title and a hint in both catalogs, and no leftover tile for a tool that is not there", () => {
    for (const catalog of [en, id]) {
      expect(Object.keys(catalog.examples).sort()).toEqual([...EXAMPLES].sort());
      for (const example of EXAMPLES) {
        expect(catalog.examples[example].title.length).toBeGreaterThan(0);
        expect(catalog.examples[example].hint.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("onboarding's hello", () => {
  it("describes what the first desk can do, in English and in Indonesian", () => {
    expect(en.intro).toMatch(/research/i);
    expect(en.intro).toMatch(/picture|image/i);
    expect(en.intro).toMatch(/presentation/i);
    expect(en.intro).not.toMatch(/document|numbers|finance/i);
    expect(id.intro).toMatch(/riset/i);
    expect(id.intro).toMatch(/presentasi/i);
    expect(id.intro).not.toMatch(/dokumen|angka|keuangan/i);
  });

  it("promises the tour in both languages, and the key exists in both", () => {
    expect(en.tourNext).toContain("tour");
    expect(id.tourNext).toContain("Tur");
    applyLocale("id");
    expect(t("onboarding.tourNext")).toBe(id.tourNext);
  });

  it("renders the hello step without the tour promise: that line belongs to the last step", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <OnboardingScreen onDone={() => {}} gateway={null} />
      </MemoryRouter>,
    );
    expect(markup).toContain('data-testid="onboarding-welcome"');
    expect(markup).not.toContain('data-testid="onboarding-tour-hint"');
  });
});
