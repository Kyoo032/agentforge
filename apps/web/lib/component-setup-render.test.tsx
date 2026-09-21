/**
 * The first-run panel, actually rendered.
 *
 * `component-setup-wiring.test.ts` reads the panel as text — it proves the testids are spelled in the
 * source and that every catalog key exists. Neither is the same as the panel producing that markup:
 * a testid on a branch that is never reached, a stage label whose key is built by template so the
 * catalog check cannot see it, or an error code with no copy behind it all survive a source grep. PR
 * #52 listed "the onboarding panel in a browser or the packaged app" as unproven, and on a desk where
 * anydoc is bundled the panel correctly renders nothing, so the grep was all there was.
 *
 * This renders it. `renderToStaticMarkup` runs the component for real against the real `t()` and the
 * real catalogs, which covers everything about the panel except its effects (the 4-second collapse)
 * and the browser. What it pins: the panel disappears when there is nothing to install, every stage
 * and every error code comes out as a sentence rather than a raw dotted key, the progress bar carries
 * the percentage it was handed, and the failure branch renders both the Retry button and the
 * reassurance that the desk works without the component.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComponentSetupPanel } from "@/components/component-setup";
import {
  COMPONENT_ERROR_CODES,
  COMPONENT_SETUP_STAGES,
  EMPTY_SETUP,
  type ComponentErrorCode,
  type ComponentStatus,
  type SetupStage,
  type SetupState,
} from "./components-client";
import { applyLocale, resetLocaleForTests } from "./i18n";
import type { ComponentSetupView } from "./use-component-setup";

const COMPONENT: ComponentStatus = {
  id: "anydoc",
  version: "0.2.4",
  state: "missing",
  source: null,
  auto: true,
  managed: false,
  bytes: 8_247_151,
};

function stages(map: Partial<Record<(typeof COMPONENT_SETUP_STAGES)[number], SetupStage["state"]>>): SetupStage[] {
  return COMPONENT_SETUP_STAGES.map((id) => ({ id, state: map[id] ?? "pending" }));
}

function view(overrides: Partial<ComponentSetupView> = {}): ComponentSetupView {
  return {
    component: COMPONENT,
    setup: EMPTY_SETUP,
    alreadyRunning: false,
    visible: true,
    retry: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<ComponentSetupView> = {}): string {
  return renderToStaticMarkup(<ComponentSetupPanel view={view(overrides)} />);
}

/** A dotted key that reached the DOM is `t()` telling us the catalog has no copy for it. */
function rawKeys(markup: string): string[] {
  return [...markup.matchAll(/onboarding\.components\.[\w.]+/g)].map((match) => match[0]);
}

describe("ComponentSetupPanel", () => {
  it("renders nothing when the host has nothing to set up", () => {
    expect(render({ component: null, visible: false })).toBe("");
  });

  it("renders nothing when a component is known but the view is not visible", () => {
    // The silent mount on an onboarded desk: the hook runs, the panel must stay out of the way.
    expect(render({ visible: false })).toBe("");
  });

  it("puts every stage on screen with the state it was given", () => {
    const markup = render({
      setup: {
        ...EMPTY_SETUP,
        status: "running",
        percent: 50,
        stages: stages({ check: "succeeded", download: "running" }),
      } satisfies SetupState,
    });
    expect(markup).toContain('data-testid="component-setup"');
    for (const id of COMPONENT_SETUP_STAGES) {
      expect(markup, id).toContain(`data-testid="component-setup-stage-${id}"`);
    }
    expect(markup).toContain('data-testid="component-setup-stage-check" data-stage-state="succeeded"');
    expect(markup).toContain('data-testid="component-setup-stage-download" data-stage-state="running"');
    expect(markup).toContain('data-testid="component-setup-stage-marker" data-stage-state="pending"');
  });

  it("reports the percentage it was handed to assistive tech and to the bar", () => {
    const markup = render({ setup: { ...EMPTY_SETUP, status: "running", percent: 42 } });
    expect(markup).toContain('aria-valuenow="42"');
    expect(markup).toContain("width:42%");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });

  it("prints the download size from the component, not a placeholder", () => {
    expect(render()).toContain("8.2");
  });

  it("says it is done when the run finished", () => {
    const markup = render({ setup: { ...EMPTY_SETUP, status: "done", percent: 100, stages: stages({}) } });
    expect(markup).toContain('data-testid="component-setup-done"');
    expect(markup).not.toContain('data-testid="component-setup-error"');
  });

  it("offers Retry and reassurance for every failure code the host can send", () => {
    for (const code of COMPONENT_ERROR_CODES) {
      const markup = render({
        setup: { ...EMPTY_SETUP, status: "failed", errorCode: code, stages: stages({ download: "failed" }) },
      });
      expect(markup, code).toContain('data-testid="component-setup-error"');
      expect(markup, code).toContain('data-testid="component-setup-retry"');
      expect(rawKeys(markup), `${code} has no copy in the catalog`).toEqual([]);
    }
  });

  it("falls back to copy, not to a dotted key, for a code it has never seen", () => {
    const markup = render({
      setup: { ...EMPTY_SETUP, status: "failed", errorCode: "not_a_real_code" as ComponentErrorCode },
    });
    expect(markup).toContain('data-testid="component-setup-error"');
    expect(rawKeys(markup)).toEqual(["onboarding.components.errors.not_a_real_code"]);
  });

  it("says another window owns the install rather than racing it", () => {
    expect(rawKeys(render({ alreadyRunning: true }))).toEqual([]);
  });

  it.each(["en", "id"])("renders every stage and error as %s copy", (locale) => {
    resetLocaleForTests();
    applyLocale(locale);
    try {
      for (const code of COMPONENT_ERROR_CODES) {
        const markup = render({
          setup: {
            ...EMPTY_SETUP,
            status: "failed",
            errorCode: code,
            percent: 20,
            stages: stages({ check: "succeeded", download: "failed" }),
          },
        });
        expect(rawKeys(markup), `${locale} / ${code}`).toEqual([]);
      }
    } finally {
      resetLocaleForTests();
    }
  });
});
