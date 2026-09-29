/**
 * Chat composer and intent cards, sized by the room they have.
 *
 * The composer is a CSS query container (`container-name: composer`), and the layout it picks —
 * one row wide, two rows medium, compact chips narrow — lives in `app/globals.css`, keyed to hooks
 * in the markup. The environment is node with no layout engine, so this cannot measure anything.
 * It holds the two halves that a browser drive cannot see go stale: the class hooks and accessible
 * names the CSS depends on (rendered, in both languages), and the shape of the CSS itself (a query
 * that names a container nothing declares matches nothing, silently). The widths are driven live:
 * `.cursor/skills/verify-agentforge/features/chat.md`, "Composer layouts".
 *
 * Two smaller contracts live here too: the Thinking select draws its own chevron (the native arrow
 * is off), and the header, the message list and the composer share one gutter token.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ChatComposer } from "@/components/chat-composer";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ModelPicker, type ChatModel } from "@/components/model-picker";
import { applyLocale, resetLocaleForTests } from "./i18n";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(web, "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
const launcher = readFileSync(join(web, "components", "chat-launcher.tsx"), "utf8");
const session = readFileSync(join(web, "components", "chat-session.tsx"), "utf8");

const MODELS: ChatModel[] = [{ id: "model-a", label: "Model A", inputModalities: ["text"] }];

function composerMarkup(): string {
  return renderToStaticMarkup(
    <ChatComposer
      threadId={null}
      modalities={["text"]}
      model="model-a"
      models={MODELS}
      onModelChange={() => {}}
      onReasoningEffortChange={() => {}}
      onDelta={() => {}}
      onComplete={() => {}}
    />,
  );
}

/** The body of the `@media (max-width: 639px)` block that carries the phone rules. */
function phoneBlock(): string {
  const match = /@media \(max-width: 639px\) \{([\s\S]*?)\n\}\n/.exec(css);
  expect(match, "globals.css must carry the phone media block").not.toBeNull();
  return match?.[1] ?? "";
}

/** The body of the `@container composer (max-width: 469px)` block: the compact layout. */
function narrowBlock(): string {
  return /@container composer \(max-width: 469px\) \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
}

/** The declarations of the first rule whose selector is exactly `selector`, outside any at-rule. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} must have a rule in globals.css`).not.toBeNull();
  return match?.[1] ?? "";
}

afterEach(() => resetLocaleForTests());

describe("composer container", () => {
  it("declares the container the queries name", () => {
    const shell = rule(".composer-shell");
    expect(shell).toContain("container-type: inline-size");
    expect(shell).toContain("container-name: composer");
  });

  it("asks four questions of it, and only of it", () => {
    const queries = [...css.matchAll(/@container\s+([\w-]+)\s*\(([^)]*)\)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(queries).toEqual([
      "composer min-width: 600px",
      "composer max-width: 599px",
      "composer max-width: 469px",
      "composer max-width: 219px",
    ]);
  });

  it("leaves the shell's own margin to a viewport rule, since a container cannot query itself", () => {
    // Horizontal: the shared gutter. Vertical: 24px, tighter on a phone. Only the token changes width.
    expect(rule(".composer-shell")).toContain("margin: var(--space-5) var(--chat-gutter)");
    expect(phoneBlock()).toMatch(/\.composer-shell \{\s*margin-block: var\(--space-2\) var\(--space-3\)/);
  });

  it("keeps the prompt box a minimum of two lines below the wide layout", () => {
    expect(rule(".composer-text")).toContain("max-height: 10rem");
    expect(css).toMatch(
      /@container composer \(max-width: 599px\) \{\s*\.composer-text \{\s*min-height: calc\(3\.2em \+ 1rem\)/,
    );
  });

  it("lets the model picker shrink in the narrow layout, and holds a floor elsewhere", () => {
    const floor = /min-width:\s*(\d+)rem/.exec(rule(".model-picker"));
    expect(floor, "the picker keeps a min-width floor outside the narrow layout").not.toBeNull();
    expect(Number(floor?.[1])).toBeGreaterThanOrEqual(7);
    expect(rule(".model-picker")).toContain("max-width: 18rem");
    expect(css).toMatch(/\.composer-controls \.model-picker \{[^}]*min-width: 0/);
  });

  it("wraps the controls instead of clipping them, and never clips a picker", () => {
    const controls = rule(".composer-controls");
    expect(controls).toContain("flex-wrap: wrap");
    expect(controls).not.toContain("overflow");
  });
});

describe("composer toolbar markup", () => {
  it("exposes a class hook for every grid area", () => {
    const html = composerMarkup();
    expect(html).toMatch(
      /class="composer-toolbar"[^>]*data-testid="composer-toolbar"|data-testid="composer-toolbar"[^>]*class="composer-toolbar"/,
    );
    for (const hook of ["composer-attach", "composer-controls", "composer-send", "composer-thinking", "model-picker"]) {
      expect(html, hook).toContain(hook);
    }
    // Layout is the CSS's; a utility left on these would fight the grid areas.
    expect(html).not.toMatch(
      /class="[^"]*\b(?:ml-auto|basis-full|flex-1)\b[^"]*"[^>]*data-testid="composer-(?:send|needs-key)"/,
    );
  });

  it("keeps every testid the drives rely on", () => {
    const html = composerMarkup();
    for (const id of [
      "composer",
      "composer-text",
      "composer-toolbar",
      "composer-attach",
      "model-picker",
      "reasoning-effort",
      "reasoning-effort-label",
      "composer-enhance",
      "composer-send",
    ]) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
  });

  it("keeps a name for each control that the narrow layout hides the words of", () => {
    const html = composerMarkup();
    // Thinking: the select carries its own name; the word and icon are presentation only.
    expect(html).toMatch(/<select[^>]*aria-label="Thinking"/);
    expect(html).toContain('class="composer-thinking-icon"');
    expect(html).toMatch(/<svg class="composer-thinking-icon"[^>]*aria-hidden="true"/);
    expect(html).toMatch(/class="composer-thinking-word"[^>]*>Thinking</);
    // Model: the "Model: " prefix stays in the tree (visually hidden by CSS), so the name still reads whole.
    expect(html).toMatch(/<span class="model-picker-prefix">Model: <\/span>Model A/);
    // Enhance: icon-only in the narrow layout, so the name and tooltip must not depend on the label.
    expect(html).toMatch(/<button[^>]*aria-label="Enhance prompt"/);
    expect(html).toMatch(/<button[^>]*title="Enhance prompt"/);
    expect(html).toContain('class="enhance-btn-label"');
  });

  it("names the same controls in Indonesian", () => {
    applyLocale("id");
    const html = composerMarkup();
    expect(html).toMatch(/<select[^>]*aria-label="Berpikir"/);
    expect(html).toContain('<span class="model-picker-prefix">Model: </span>');
    expect(html).toMatch(/<button[^>]*aria-label="Tingkatkan prompt"/);
    expect(html).toMatch(/<button[^>]*aria-label="Lampirkan"/);
  });

  it("hides the words with CSS that keeps them readable to a screen reader", () => {
    const narrow = narrowBlock();
    expect(narrow).toContain(".model-picker-prefix");
    expect(narrow).toContain(".composer-thinking-word");
    expect(narrow).toContain(".enhance-btn-label");
    // The visually-hidden recipe, not `display: none`, which would drop them from the tree.
    expect(narrow).toContain("clip: rect(0, 0, 0, 0)");
    expect(narrow).not.toMatch(
      /(?:model-picker-prefix|composer-thinking-word|enhance-btn-label)[^{]*\{[^}]*display:\s*none/,
    );
    expect(narrow).toContain("--chip-h: 2.5rem");
  });
});

describe("thinking chevron", () => {
  it("draws its own chevron inside the pill, hidden from assistive technology", () => {
    const html = composerMarkup();
    const label = /<label class="composer-thinking[^"]*">([\s\S]*?)<\/label>/.exec(html)?.[1] ?? "";
    expect(label, "the Thinking pill is a label").not.toBe("");
    // After the select, so `select:disabled + .composer-thinking-chevron` can dim it with the select.
    expect(label).toMatch(/<\/select><svg class="composer-thinking-chevron"[^>]*aria-hidden="true"/);
    expect(label.match(/composer-thinking-chevron/g)).toHaveLength(1);
    // The select keeps its own name; the chevron adds none (no <title>, no role, no aria-label).
    expect(label).toMatch(/<select[^>]*aria-label="Thinking"/);
    const chevron = /<svg class="composer-thinking-chevron"[\s\S]*?<\/svg>/.exec(label)?.[0] ?? "";
    expect(chevron).not.toMatch(/<title|role=|aria-label/);
    expect(chevron).toContain('stroke="currentColor"');
  });

  it("switches the native arrow off, so Chrome's edge-hugging arrow cannot come back", () => {
    const select = rule(".composer-thinking select");
    expect(select).toContain("appearance: none");
    expect(select).toContain("-webkit-appearance: none");
    // The room to the right is the chevron's, not a magic number that the native arrow ignored.
    expect(select).toContain("padding-right: var(--chevron-room)");
    // No image-based arrow: a `data:` background would depend on the renderer's img-src policy.
    expect(css).not.toMatch(/\.composer-thinking[^{]*\{[^}]*(?:background-image|url\()/);
  });

  it("places the chevron against the pill and keeps it out of the click path", () => {
    expect(rule(".composer-thinking")).toContain("position: relative");
    const chevron = rule(".composer-thinking-chevron");
    expect(chevron).toContain("position: absolute");
    expect(chevron).toContain("right: var(--chevron-inset)");
    expect(chevron).toContain("pointer-events: none");
    // A disabled select dims itself, and the chevron follows.
    expect(css).toMatch(/\.composer-thinking select:disabled \+ \.composer-thinking-chevron \{\s*opacity:/);
  });

  it("keeps the same gap in the compact layout, where the border becomes an inset ring", () => {
    const pill = rule(".composer-thinking");
    // 12px from the pill's outer edge in both: the glyph sits 2px inside its 12px box, and the wide
    // pill has a 1px border, so the box inset is 9px there and 10px on the borderless ring.
    expect(pill).toContain("--chevron-inset: 9px");
    expect(narrowBlock()).toMatch(/\.composer-thinking \{[^}]*--chevron-inset: 10px[^}]*border-width: 0/);
    // The narrow select's shorthand padding still reserves the chevron's room on its right.
    expect(narrowBlock()).toMatch(/\.composer-thinking select \{[^}]*padding: 0 var\(--chevron-room\) 0 32px/);
    // The narrow rules must not re-declare `position`; the base rule already places the pill.
    expect(narrowBlock()).not.toMatch(/\.composer-thinking \{[^}]*position:/);
  });
});

describe("chat gutter", () => {
  it("is one token: 24px by default and 12px on a phone", () => {
    expect(css).toMatch(/:root \{[^}]*--chat-gutter: var\(--space-5\);/);
    expect(phoneBlock()).toMatch(/:root \{\s*--chat-gutter: var\(--space-3\);\s*\}/);
    // `--space-5` / `--space-3` are the 24px / 12px steps the composer's margin used before.
    expect(css).toMatch(/--space-5: 24px;/);
    expect(css).toMatch(/--space-3: 12px;/);
  });

  it("is read by the header, the error row, the message list and the composer", () => {
    // The class list of the element that carries a testid: the last `className=` before it.
    const classesOf = (testid: string) => {
      const before = session.slice(0, session.indexOf(`data-testid="${testid}"`));
      return before.slice(before.lastIndexOf("className="));
    };
    // The header is its own component (`chat-header.tsx`); its root carries the gutter.
    const header = readFileSync(join(web, "components", "chat-header.tsx"), "utf8");
    const beforeHeader = header.slice(0, header.indexOf('data-testid="chat-header"'));
    expect(beforeHeader.slice(beforeHeader.lastIndexOf("className="))).toContain("px-[var(--chat-gutter)]");
    expect(classesOf("message-list")).toContain("px-[var(--chat-gutter)]");
    expect(rule(".composer-shell")).toContain("var(--chat-gutter)");
    // The error banner between the header and the list is part of the column too.
    expect(session).toMatch(/flex w-full items-start gap-3 px-\[var\(--chat-gutter\)\]/);
    // No literal 24px padding left on the column's own rows (px-6 would drift on a phone).
    const column = session.slice(session.indexOf('data-testid="chat-home"'), session.indexOf("<ChatComposer"));
    expect(column).not.toMatch(/\bpx-6\b/);
  });
});

describe("controls on their own", () => {
  it("renders the model picker's prefix as its own span", () => {
    const html = renderToStaticMarkup(<ModelPicker models={MODELS} value="model-a" onChange={() => {}} />);
    expect(html).toContain('class="model-picker"');
    expect(html).toContain('class="model-picker-prefix"');
    expect(html).not.toMatch(/class="[^"]*\bh-8\b/);
  });

  it("gives the enhance button its own tooltip and a label span to hide", () => {
    const html = renderToStaticMarkup(<EnhancePromptButton text="draft" surface="chat" pill onApply={() => {}} />);
    expect(html).toContain("enhance-btn");
    expect(html).toContain('title="Enhance prompt"');
    expect(html).toContain('<span class="enhance-btn-label">Enhance prompt</span>');
    expect(html).not.toMatch(/class="[^"]*\bh-8\b/);
  });
});

describe("intent cards grid", () => {
  it("takes its columns from the room it has, not the viewport", () => {
    const grid = rule(".chat-ideas-grid");
    expect(grid).toContain("display: grid");
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(16rem,\s*100%\),\s*1fr\)\)/);
    expect(launcher).toContain("chat-ideas-grid");
    expect(launcher).not.toMatch(/grid-cols-|sm:grid/);
  });

  it("does not give a card a width of its own to fight the grid", () => {
    const card = /className="card-live[^"]*"/.exec(launcher)?.[0] ?? "";
    expect(card).not.toMatch(/\b(?:w-|min-w-|max-w-|basis-)/);
  });
});
