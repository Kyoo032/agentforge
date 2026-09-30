/**
 * The step registry against the real desk: every anchor names an element the app actually renders,
 * the ids and placements are well formed, and the tour stays the short one that was asked for.
 *
 * The renderer has no DOM in its tests, so "the anchor exists" is a scan of the component sources for
 * the testid or `data-tour` hook the selector names. A renamed testid then fails here instead of
 * turning a step into a centred card nobody notices.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE_STEPS } from "./guide-steps";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string {
  let text = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      text += sources(full);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      text += `${readFileSync(full, "utf8")}\n`;
    }
  }
  return text;
}

const ALL = `${sources(join(webRoot, "components"))}${sources(join(webRoot, "src"))}`;

/** `[data-testid="x"]` -> the JSX attribute text that renders it; `[data-tour="x"]` likewise; `[data-rail]` bare. */
function renderedBy(selector: string): RegExp {
  const attribute = selector.match(/^\[(data-[\w-]+)(?:="([^"]+)")?\]$/);
  if (!attribute) {
    throw new Error(`unsupported anchor selector ${selector}`);
  }
  const [, name, value] = attribute;
  if (!value) {
    return new RegExp(`\\b${name}=`);
  }
  // A testid is either written on the element or handed to `RailItem` as its `testId` prop.
  const prop = name === "data-testid" ? `(?:${name}|testId)` : name;
  return new RegExp(`${prop}=["'{]+\\s*${value}`);
}

describe("the guide's step registry", () => {
  it("is the short tour asked for: 4 to 6 steps, unique ids", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(GUIDE_STEPS.length).toBeLessThanOrEqual(6);
    expect(new Set(GUIDE_STEPS.map((step) => step.id)).size).toBe(GUIDE_STEPS.length);
  });

  it("covers what was asked: the rail's tools, Workspaces, the Chat composer, the Knowledge Base, Settings", () => {
    expect(GUIDE_STEPS.map((step) => step.id)).toEqual(["modes", "workspaces", "chat", "knowledge", "settings"]);
  });

  it("gives every step at least one anchor, a real placement and its own copy keys", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.anchors.length, step.id).toBeGreaterThan(0);
      expect(["right", "left", "top", "bottom", "center"], step.id).toContain(step.placement);
      expect(step.titleKey, step.id).toBe(`guide.steps.${step.id}.title`);
      expect(
        step.body({ toolLabels: ["A", "B"], missingToolLabels: ["C"], formatList: (items) => items.join(", ") }).key,
        step.id,
      ).toMatch(
        new RegExp(`^guide\\.steps\\.${step.id}\\.body`),
      );
    }
  });

  it("points at elements the desk renders", () => {
    for (const step of GUIDE_STEPS) {
      for (const selector of step.anchors) {
        expect(renderedBy(selector).test(ALL), `${step.id}: nothing renders ${selector}`).toBe(true);
      }
    }
  });

  it("does not need the desk to have any particular tool: only always-on chrome and Chat", () => {
    const anchors = GUIDE_STEPS.flatMap((step) => step.anchors);
    for (const mode of ["research", "images", "videos", "presentations", "documents", "finance"]) {
      expect(anchors.join(" ")).not.toContain(`mode-${mode}`);
    }
  });
});
