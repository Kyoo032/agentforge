/**
 * The first-run guide's copy: both catalogs have the same keys, every key the registry and the card
 * read exists in both, and no string is a raw key or an English leftover in the Indonesian catalog.
 */
import { afterEach, describe, expect, it } from "vitest";
import en from "../locales/en/guide.json";
import id from "../locales/id/guide.json";
import { GUIDE_STEPS, guideContextFor } from "./guide-steps";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

function vars(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

function modesStep() {
  const step = GUIDE_STEPS.find((candidate) => candidate.id === "modes");
  if (!step) {
    throw new Error("the registry has no modes step");
  }
  return step;
}

function leaf(tree: unknown, path: string): string {
  return path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string;
}

afterEach(() => {
  resetLocaleForTests();
});

describe("guide catalogs", () => {
  it("keep en and id key trees aligned", () => {
    expect(keysOf(id).sort()).toEqual(keysOf(en).sort());
  });

  it("use the same {variables} in both languages, key for key", () => {
    for (const key of keysOf(en)) {
      expect(vars(leaf(id, key)), key).toEqual(vars(leaf(en, key)));
    }
  });

  it("have no empty string", () => {
    for (const key of keysOf(en)) {
      expect(leaf(en, key).trim().length, `en ${key}`).toBeGreaterThan(0);
      expect(leaf(id, key).trim().length, `id ${key}`).toBeGreaterThan(0);
    }
  });

  it("translate rather than copy: no Indonesian string equals its English one", () => {
    for (const key of keysOf(en)) {
      expect(leaf(id, key), key).not.toBe(leaf(en, key));
    }
  });
});

describe("what the registry reads", () => {
  const join = (items: readonly string[]) => items.join(", ");
  const rail = {
    toolLabels: ["Research", "Images", "Videos", "Presentation"],
    missingToolLabels: ["Documents", "Finance", "Data", "Market", "Legal"],
    formatList: join,
  };
  const one = { ...rail, toolLabels: ["Legal"], missingToolLabels: ["Documents"] };
  const many = { ...rail, toolLabels: ["a", "b", "c", "d", "e", "f", "g"], missingToolLabels: ["x"] };
  const none = { ...rail, toolLabels: [], missingToolLabels: ["Documents", "Finance"] };
  const everything = { ...rail, toolLabels: ["a", "b", "c", "d", "e", "f", "g"], missingToolLabels: [] };

  it("has a title and a body in both catalogs for every step and every body variant", () => {
    for (const locale of ["en", "id"] as const) {
      applyLocale(locale);
      for (const step of GUIDE_STEPS) {
        for (const context of [rail, one, many, none, everything]) {
          const copy = step.body(context);
          const body = t(copy.key, copy.vars);
          expect(body, `${locale} ${step.id} body`).not.toBe(copy.key);
          expect(body, `${locale} ${step.id} body has an unfilled variable`).not.toMatch(/\{\w+\}/);
          expect(t(step.titleKey), `${locale} ${step.id} title`).not.toBe(step.titleKey);
        }
      }
    }
  });

  it("names the tools on the desk in the modes step, and only when there are a few", () => {
    applyLocale("en");
    const modes = modesStep();

    const listed = modes.body(rail);
    expect(t(listed.key, listed.vars)).toContain("your 4 tools: Research, Images, Videos, Presentation.");
    expect(modes.body(many).key).toBe("guide.steps.modes.bodyMany");
    expect(modes.body(none).key).toBe("guide.steps.modes.bodyNone");
  });

  it("says 'your tool' for one tool, never 'your 1 tools'", () => {
    applyLocale("en");
    const copy = modesStep().body(one);

    expect(copy.key).toBe("guide.steps.modes.bodyOne");
    expect(t(copy.key, copy.vars)).toBe("Chat is home. Below it is your tool: Legal. Pick it to start.");
  });

  it("offers only the tools the desk does not have, three examples at most, and never one it already has", () => {
    applyLocale("en");
    const workspaces = GUIDE_STEPS.find((step) => step.id === "workspaces");
    if (!workspaces) {
      throw new Error("the registry has no workspaces step");
    }

    const more = workspaces.body(rail);
    expect(more.key).toBe("guide.steps.workspaces.bodyMore");
    expect(t(more.key, more.vars)).toContain("like Documents, Finance, Data?");
    expect(t(more.key, more.vars)).not.toContain("Market");
    expect(workspaces.body(none).vars?.tools).toBe("Documents, Finance");

    // A desk that has everything (the hosted first desk) is not offered what it already shows.
    const all = workspaces.body(everything);
    expect(all.key).toBe("guide.steps.workspaces.bodyAll");
    expect(t(all.key, all.vars)).toContain("Every tool is already on this desk");
    expect(t(all.key, all.vars)).not.toContain("Documents");
  });

  it("works out what is missing from the desk's own rail", () => {
    const first = guideContextFor(["chat", "research", "images", "videos", "presentations"], (mode) => mode);
    expect(first.missingToolLabels).toEqual([
      "documents",
      "finance",
      "data",
      "market",
      "legal",
      "meeting",
      "music",
      "edit",
      "education",
    ]);
    const every = guideContextFor(
      ["chat", "documents", "research", "finance", "data", "market", "legal", "meeting", "images", "videos", "music", "edit", "presentations", "education"],
      (mode) => mode,
    );
    expect(every.missingToolLabels).toEqual([]);
  });

  it("builds the tool list from the desk's rail in catalog order, Chat left out", () => {
    const context = guideContextFor(["images", "chat", "research", "presentations", "videos"], (mode) => mode);

    expect(context.toolLabels).toEqual(["research", "images", "videos", "presentations"]);
    expect(guideContextFor(["chat"], (mode) => mode).toolLabels).toEqual([]);
  });

  it("joins the list in the reader's language with a real conjunction", () => {
    applyLocale("id");
    const context = guideContextFor(["chat", "research", "images", "videos", "presentations"], (mode) => t(`rail.${mode}`), (items) =>
      new Intl.ListFormat("id", { style: "long", type: "conjunction" }).format(items),
    );
    const modes = modesStep();
    const copy = modes.body(context);

    expect(t(copy.key, copy.vars)).toContain("Riset, Gambar, Video, dan Presentasi");
  });
});

describe("the card's own strings", () => {
  it("exist in both languages", () => {
    for (const locale of ["en", "id"] as const) {
      applyLocale(locale);
      for (const key of [
        "guide.dialogLabel",
        "guide.offer.title",
        "guide.offer.body",
        "guide.offer.start",
        "guide.progress",
        "guide.next",
        "guide.back",
        "guide.skip",
        "guide.done",
        "guide.close",
        "guide.replay.title",
        "guide.replay.body",
        "guide.replay.button",
      ]) {
        expect(t(key, { productName: "Nultron", total: 5, current: 2 }), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
