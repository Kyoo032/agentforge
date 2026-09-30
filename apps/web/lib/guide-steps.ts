import { PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import type { GuidePlacement } from "./guide-placement";

/**
 * The first-run guide's steps, as data. The state machine (`guide-machine.ts`) only counts them; the
 * card (`components/guide-card.tsx`) prints them; the tour (`components/guide-tour.tsx`) points at
 * their anchors. Adding a stop is adding a row here and two catalog keys, nothing else.
 *
 * Every anchor is a selector for an element that already exists on the real desk (a testid, or the
 * one `data-tour` hook added to the rail's nav). A step whose anchor is not on screen (a collapsed
 * rail that has no room, a window too narrow to place a card beside it, a route that does not have
 * it) is shown as a centred card instead. The tour never breaks and never skips a step because of
 * where it happens to be standing.
 *
 * No step navigates, and neither does the replay in Settings: the tour points at what is on the desk
 * where the person is standing. The composer stop is therefore a centred card when the guide runs
 * from a page with no composer (Settings), and its words read the same either way.
 */
export type GuideContext = {
  /** Localised labels of the tools on this desk's rail, in rail order, Chat excluded. */
  readonly toolLabels: readonly string[];
  /** Localised labels of the tools this desk does not have yet, in catalog order, Chat excluded. */
  readonly missingToolLabels: readonly string[];
  /** "A, B, and C" in the reader's language (`listFormatter`). */
  readonly formatList: (items: readonly string[]) => string;
};

export type GuideCopy = { readonly key: string; readonly vars?: Record<string, string | number> };

export type GuideStep = {
  readonly id: string;
  /** Selectors tried in order. The first visible match is the anchor; none means a centred card. */
  readonly anchors: readonly string[];
  readonly placement: GuidePlacement;
  readonly titleKey: string;
  /** The body's key, and any variables it takes, may depend on what the desk shows. */
  readonly body: (context: GuideContext) => GuideCopy;
};

/** The largest number of tools named out loud in step one. Past it the sentence stops listing. */
export const GUIDE_LISTED_TOOLS_MAX = 5;

/** How many missing tools step two names as examples. */
export const GUIDE_SUGGESTED_TOOLS = 3;

/** Step one says what is on this desk: none, one, a few by name, or a sentence that does not list. */
function modesBody(context: GuideContext): GuideCopy {
  const count = context.toolLabels.length;
  if (count === 0) {
    return { key: "guide.steps.modes.bodyNone" };
  }
  if (count > GUIDE_LISTED_TOOLS_MAX) {
    return { key: "guide.steps.modes.bodyMany" };
  }
  const tools = context.formatList(context.toolLabels);
  return count === 1
    ? { key: "guide.steps.modes.bodyOne", vars: { tools } }
    : { key: "guide.steps.modes.bodyList", vars: { count, tools } };
}

/**
 * Step two says what can still be added. A desk that has every tool (the hosted first desk, an owner
 * who already switched them all on) is told so, rather than offered what it already shows.
 */
function workspacesBody(context: GuideContext): GuideCopy {
  if (context.missingToolLabels.length === 0) {
    return { key: "guide.steps.workspaces.bodyAll" };
  }
  return {
    key: "guide.steps.workspaces.bodyMore",
    vars: { tools: context.formatList(context.missingToolLabels.slice(0, GUIDE_SUGGESTED_TOOLS)) },
  };
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "modes",
    anchors: ['[data-tour="rail-modes"]', "[data-rail]"],
    placement: "right",
    titleKey: "guide.steps.modes.title",
    body: modesBody,
  },
  {
    id: "workspaces",
    anchors: ['[data-testid="workspaces-link"]'],
    placement: "right",
    titleKey: "guide.steps.workspaces.title",
    body: workspacesBody,
  },
  {
    id: "chat",
    anchors: ['[data-testid="composer"]'],
    placement: "top",
    titleKey: "guide.steps.chat.title",
    body: () => ({ key: "guide.steps.chat.body" }),
  },
  {
    id: "knowledge",
    anchors: ['[data-testid="mode-knowledge"]'],
    placement: "right",
    titleKey: "guide.steps.knowledge.title",
    body: () => ({ key: "guide.steps.knowledge.body" }),
  },
  {
    id: "settings",
    anchors: ['[data-testid="settings-link"]'],
    placement: "right",
    titleKey: "guide.steps.settings.title",
    body: () => ({ key: "guide.steps.settings.body" }),
  },
];

/** "Research, Images, Videos, and Presentation" / "Riset, Gambar, Video, dan Presentasi". */
export function listFormatter(locale: string): (items: readonly string[]) => string {
  try {
    const formatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    return (items) => formatter.format(items);
  } catch {
    return (items) => items.join(", ");
  }
}

/**
 * Labels for the tools on a desk's rail, in catalog order. `labelFor` is the caller's translator
 * for a mode's rail label, passed in so this stays a pure function of the desk.
 */
export function guideContextFor(
  visibleModes: readonly ProductMode[],
  labelFor: (id: ProductMode) => string,
  formatList: (items: readonly string[]) => string = (items) => items.join(", "),
): GuideContext {
  const tools = PRODUCT_MODES.filter((mode) => mode.id !== "chat");
  return {
    toolLabels: tools.filter((mode) => visibleModes.includes(mode.id)).map((mode) => labelFor(mode.id)),
    missingToolLabels: tools.filter((mode) => !visibleModes.includes(mode.id)).map((mode) => labelFor(mode.id)),
    formatList,
  };
}
