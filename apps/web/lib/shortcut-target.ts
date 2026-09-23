/**
 * Guards for window-level keyboard shortcuts.
 *
 * The shell keeps every visited work mode mounted behind a `hidden` pane
 * (`components/work-mode-keep-alive.tsx`), so a `window` keydown listener outlives its page being
 * shown. A shortcut therefore has to ask two things before it acts: is my page the one on screen,
 * and is the focused element one that uses this key itself?
 */

/** The element surface these guards read. Structural, so they run against a real node or a test fake. */
export type ShortcutElement = {
  tagName: string;
  isContentEditable?: boolean;
  isConnected?: boolean;
  getAttribute?: (name: string) => string | null;
  closest: (selector: string) => unknown;
};

/**
 * True when `element` sits inside a pane the shell has hidden, or is not in the document at all.
 * Either way nothing on screen asked for the shortcut. Same test `edit-studio.tsx` applies to itself.
 */
export function isInHiddenPane(element: ShortcutElement | null | undefined): boolean {
  if (!element || element.isConnected === false) {
    return true;
  }
  return element.closest("[hidden]") != null;
}

/** Elements that take keys themselves: typing, arrows, Space, Enter. */
const KEY_CONSUMING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

/** ARIA widgets that take keys themselves, for custom controls that are not one of the tags above. */
const KEY_CONSUMING_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "grid",
  "gridcell",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "textbox",
  "tree",
  "treegrid",
  "treeitem",
]);

/** True when the focused element uses keys itself, so a page shortcut must leave the key alone. */
export function consumesKeys(target: ShortcutElement | null | undefined): boolean {
  if (!target) {
    return false;
  }
  if (KEY_CONSUMING_TAGS.has(target.tagName) || target.isContentEditable === true) {
    return true;
  }
  const role = target.getAttribute?.("role");
  return role != null && KEY_CONSUMING_ROLES.has(role.trim().toLowerCase());
}

export type ShortcutKeyEvent = {
  target: unknown;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

function asShortcutElement(value: unknown): ShortcutElement | null {
  return value && typeof value === "object" && typeof (value as { tagName?: unknown }).tagName === "string"
    ? (value as ShortcutElement)
    : null;
}

/**
 * The Edit studio's single-key shortcuts (Space, J/K/L, S, Delete) stay out of the way of a focused
 * control, and of any chord: Ctrl/Cmd+S, Cmd+L and Ctrl/Cmd+K belong to the browser and the model
 * picker, not to split, seek and play. Shift is allowed; `S` and `s` both split.
 */
export function isEditShortcutIgnored(event: ShortcutKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return true;
  }
  return consumesKeys(asShortcutElement(event.target));
}
