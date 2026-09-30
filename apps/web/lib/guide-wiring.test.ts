/**
 * Where the first-run guide is wired in, and the rules its sources keep. The renderer's tests have no
 * DOM, so these read the sources: they fail when somebody moves the offer, drops the inert root, lets
 * a click on the dimmed desk do something, adds a looping animation, or types an English word into
 * JSX. The behaviour itself is driven in a real browser (see the verify recipe `features/guide.md`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "..", "..");
const read = (relative: string, root = webRoot) => readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const app = read("src/App.tsx");
const tour = read("components/guide-tour.tsx");
const card = read("components/guide-card.tsx");
const replay = read("components/settings-guide-card.tsx");
const store = read("lib/guide-store.ts");
const settingsPage = read("components/settings-page.tsx");
const rail = read("components/app-rail.tsx");

const GUIDE_SOURCES: Record<string, string> = {
  "components/guide-tour.tsx": tour,
  "components/guide-card.tsx": card,
  "components/settings-guide-card.tsx": replay,
};

describe("the guide is wired into the app", () => {
  it("is offered when first-run setup ends, and at no other moment", () => {
    const onboarding = app.slice(app.indexOf("<OnboardingScreen"), app.indexOf("</PlanBlockBoundary>", app.indexOf("<OnboardingScreen")));
    expect(onboarding).toContain("offerGuideAfterOnboarding()");
    expect(onboarding).toContain('setGate("app")');
    expect(app.match(/offerGuideAfterOnboarding\(\)/g)).toHaveLength(1);
    expect(app.match(/dispatchGuide|replayGuide/g)).toBeNull();
  });

  it("learns from the host whether the person has been through it, on every settings read", () => {
    expect(app).toContain("hydrateGuide(payload?.guide)");
  });

  it("mounts the tour in the shell, after the desk has loaded", () => {
    expect(app).toContain("<GuideTour visibleModes={visibleModes} ready={workspaceId !== null} />");
  });

  it("reports how it ended to the host route that stores it", () => {
    expect(store).toContain('"/api/v1/settings/guide"');
    expect(read("packages/host/src/router.ts", repoRoot)).toContain('compile("POST", "/api/v1/settings/guide", handlePostGuide)');
  });

  it("has a Replay button on Settings that opens the tour where the person is, without navigating", () => {
    expect(settingsPage).toContain("<SettingsGuideCard />");
    expect(replay).toContain('data-testid="settings-guide-replay"');
    expect(replay).toContain("onClick={() => replayGuide()}");
    // The tour never moves the person between pages; focus can then return to this button.
    expect(replay.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/router|navigate|useNavigate|push\(/);
    expect(tour).not.toMatch(/useNavigate|router\.push|navigate\(/);
  });

  it("marks the rail's nav as the first step's anchor", () => {
    expect(rail).toContain('data-tour="rail-modes"');
  });
});

describe("the tour keeps its promises", () => {
  it("makes the app inert while open and gives it back, and returns focus", () => {
    expect(tour).toContain('root?.setAttribute("inert", "")');
    expect(tour).toContain('root?.removeAttribute("inert")');
    expect(tour).toContain("restoreFocus(previous)");
    expect(tour).toContain("document.activeElement");
  });

  it("gives the app back before it returns focus, so focus can land on what it left", () => {
    // Focus cannot be restored into an inert subtree. Reordering these two lines would compile, pass every
    // unit test, and strand focus on `<body>` after every close.
    expect(tour.indexOf('root?.removeAttribute("inert")')).toBeGreaterThan(-1);
    expect(tour.indexOf('root?.removeAttribute("inert")')).toBeLessThan(tour.indexOf("restoreFocus(previous);"));
    // The whole-panel fallback takes no focus ring, and is used when `<body>` or a gone element held focus.
    expect(tour).toContain('panel.style.outline = "none"');
    expect(tour).toContain("previous !== document.body");
  });

  it("swallows a held key, and lets the card scroll on a window too small for it", () => {
    expect(tour).toContain("swallowsRepeat(event)");
    expect(card).toContain("max-h-[calc(100dvh-24px)]");
    expect(card).toContain("overflow-y-auto");
  });

  it("does nothing on a click outside the card: the backdrop only swallows it", () => {
    const backdrop = tour.slice(tour.indexOf('data-testid="guide-backdrop"'), tour.indexOf("{spotlight ? ("));
    expect(backdrop).toContain("onPointerDown={(event) => event.preventDefault()}");
    expect(backdrop).toContain("onClick={(event) => event.preventDefault()}");
    expect(backdrop).not.toContain("dispatchGuide");
  });

  it("closes on Escape and traps Tab, through the shared keyboard contract", () => {
    expect(tour).toContain('document.addEventListener("keydown", onKeyDown, true)');
    expect(tour).toContain("guideKeyAction(");
    expect(tour).toContain("tabWouldLeave(");
  });

  it("never loops: no infinite animation, no Tailwind spin, pulse, bounce or ping", () => {
    // Class names built by concatenation: Tailwind's `content` reads this file too, and a spelled-out
    // utility name here would make it generate the very rule this test forbids.
    const banned = ["infin" + "ite", "animate" + "-spin", "animate" + "-pulse", "animate" + "-bounce", "animate" + "-ping", "repeatCount"];
    for (const [file, source] of Object.entries(GUIDE_SOURCES)) {
      for (const word of banned) {
        expect(source, `${file} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("only re-measures while open: its timer lives in an effect of the mounted overlay and is cleared", () => {
    expect(tour).toContain("window.setInterval(measureNow, REMEASURE_MS)");
    expect(tour).toContain("window.clearInterval(timer)");
  });
});

describe("the guide's sources hold no English", () => {
  /** Text between a `>` and the next `<` that starts with a letter, in a JSX file, outside `{}`. */
  const JSX_TEXT = />\s*([A-Za-z][A-Za-z ,.'!?-]*)\s*</g;

  it("has no word of copy in the JSX: every string comes from the catalog", () => {
    for (const [file, source] of Object.entries(GUIDE_SOURCES)) {
      // Drop generics and type positions first: `Record<string, unknown>` is not copy.
      const jsx = source.replace(/\b[A-Za-z]+<[^>]*>/g, "");
      const found = [...jsx.matchAll(JSX_TEXT)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
      expect(found, `${file} has literal JSX text`).toEqual([]);
    }
  });
});
