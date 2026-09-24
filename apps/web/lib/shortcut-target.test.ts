/**
 * Window-level shortcuts in a keep-alive shell.
 *
 * Every visited work mode stays mounted behind a `hidden` pane (`work-mode-keep-alive.tsx`), so a
 * `window` keydown listener keeps listening after its page is hidden. The Chat model picker opened on
 * Cmd/Ctrl+K from any other mode, portalled over it; the Edit studio's J/K/L/S/Space/Delete fired on
 * a focused button or select. Both decisions are read off the element, so they are tested here with
 * element-shaped fakes; the environment has no DOM.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { consumesKeys, isEditShortcutIgnored, isInHiddenPane } from "./shortcut-target";

type FakeElement = {
  tagName: string;
  isContentEditable?: boolean;
  isConnected?: boolean;
  attributes?: Record<string, string>;
  hiddenAncestor?: boolean;
};

function element(fake: FakeElement) {
  return {
    tagName: fake.tagName,
    isContentEditable: fake.isContentEditable ?? false,
    isConnected: fake.isConnected ?? true,
    getAttribute: (name: string) => fake.attributes?.[name] ?? null,
    closest: (selector: string) => (selector === "[hidden]" && fake.hiddenAncestor ? {} : null),
  };
}

describe("isInHiddenPane", () => {
  it("is true inside a pane the shell hid, and false in the visible one", () => {
    expect(isInHiddenPane(element({ tagName: "BUTTON", hiddenAncestor: true }))).toBe(true);
    expect(isInHiddenPane(element({ tagName: "BUTTON" }))).toBe(false);
  });

  it("treats a missing or detached element as hidden: nothing on screen asked for the shortcut", () => {
    expect(isInHiddenPane(null)).toBe(true);
    expect(isInHiddenPane(undefined)).toBe(true);
    expect(isInHiddenPane(element({ tagName: "BUTTON", isConnected: false }))).toBe(true);
  });
});

describe("consumesKeys", () => {
  it("lets text fields, selects and buttons keep their own keys", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) {
      expect(consumesKeys(element({ tagName })), tagName).toBe(true);
    }
    expect(consumesKeys(element({ tagName: "DIV", isContentEditable: true }))).toBe(true);
  });

  it("lets widgets whose role takes arrows, space or typing keep them", () => {
    for (const role of [
      "textbox",
      "combobox",
      "listbox",
      "option",
      "menuitem",
      "slider",
      "spinbutton",
      "tab",
      "grid",
      "radio",
      "checkbox",
      "switch",
      "button",
    ]) {
      expect(consumesKeys(element({ tagName: "DIV", attributes: { role } })), role).toBe(true);
    }
  });

  it("leaves plain surfaces to the shortcut", () => {
    expect(consumesKeys(element({ tagName: "DIV" }))).toBe(false);
    expect(consumesKeys(element({ tagName: "BODY" }))).toBe(false);
    expect(consumesKeys(element({ tagName: "SECTION", attributes: { role: "region" } }))).toBe(false);
    expect(consumesKeys(null)).toBe(false);
  });
});

describe("isEditShortcutIgnored", () => {
  const body = element({ tagName: "BODY" });

  it("ignores a key typed into a field, a select or a focused button", () => {
    expect(isEditShortcutIgnored({ target: element({ tagName: "BUTTON" }) })).toBe(true);
    expect(isEditShortcutIgnored({ target: element({ tagName: "SELECT" }) })).toBe(true);
    expect(isEditShortcutIgnored({ target: element({ tagName: "INPUT" }) })).toBe(true);
  });

  it("ignores a chord: Ctrl+S, Cmd+L and Ctrl+K belong to the browser and the model picker", () => {
    expect(isEditShortcutIgnored({ target: body, ctrlKey: true })).toBe(true);
    expect(isEditShortcutIgnored({ target: body, metaKey: true })).toBe(true);
    expect(isEditShortcutIgnored({ target: body, altKey: true })).toBe(true);
  });

  it("takes a bare key, or a shifted one, on the page itself", () => {
    expect(isEditShortcutIgnored({ target: body })).toBe(false);
    expect(isEditShortcutIgnored({ target: body, shiftKey: true })).toBe(false);
  });
});

describe("wiring", () => {
  const components = resolve(dirname(fileURLToPath(import.meta.url)), "../components");

  it("the model picker ignores Cmd/Ctrl+K while its pane is hidden, before claiming the key", () => {
    const picker = readFileSync(resolve(components, "model-picker.tsx"), "utf8");
    const handler = picker.slice(picker.indexOf("function onKeyDown(event: KeyboardEvent)"));
    const hiddenCheck = handler.indexOf("if (isInHiddenPane(triggerRef.current)) {");
    expect(hiddenCheck).toBeGreaterThan(-1);
    expect(hiddenCheck).toBeLessThan(handler.indexOf("event.preventDefault();"));
  });

  it("the Edit studio asks isEditShortcutIgnored before any shortcut runs", () => {
    const studio = readFileSync(resolve(components, "edit-studio.tsx"), "utf8");
    const handler = studio.slice(studio.indexOf("function onKey(event: KeyboardEvent)"));
    const ignored = handler.indexOf("if (isEditShortcutIgnored(event)) {");
    expect(ignored).toBeGreaterThan(-1);
    expect(ignored).toBeLessThan(handler.indexOf('if (event.key === " "'));
  });
});
