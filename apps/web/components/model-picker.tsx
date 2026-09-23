"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { formatContextLength, pickerGroups } from "@agentforge/core/preferred";
import { isThinkingModel } from "@agentforge/core/curation";
import { t } from "@/lib/i18n";
import { placePickerPanel, viewportBounds, type PickerPanelPos } from "@/lib/picker-panel";

export type ChatModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Optional curation metadata (friendly label / best-for hint). */
  friendlyLabel?: string;
  bestFor?: string;
  tier?: "everyday" | "advanced";
};

type Props = {
  models: ChatModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Focus target when Escape closes the palette (composer textarea). */
  returnFocusRef?: RefObject<HTMLTextAreaElement | null>;
};

type FlatEntry = {
  model: ChatModel;
  optionId: string;
};

type DisplayGroup = {
  label: string;
  models: ChatModel[];
};

/** Group ids come from core (English labels); the renderer maps the known ones onto catalog keys. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  Recommended: "chat.models.groups.recommended",
};

const RECOMMENDED_GROUP = "Recommended";

function groupLabel(label: string): string {
  const key = GROUP_LABEL_KEYS[label];
  if (!key) {
    return label;
  }
  const translated = t(key);
  return translated === key ? label : translated;
}

function modalityTags(mods: string[]): string[] {
  const extra = mods.filter((m) => m !== "text");
  return extra.length > 0 ? extra : [];
}

function displayName(model: ChatModel): string {
  return model.friendlyLabel ?? model.label;
}

/** How the palette was opened. Escape hands focus back to the same place. */
export type PickerOpener = "trigger" | "shortcut";

export type PickerCloseReason = "escape" | "select" | "outside" | "toggle";

export type PickerFocusTarget = "trigger" | "composer" | null;

/**
 * Where focus goes when the palette closes.
 *
 * Escape returns to whatever opened it: the trigger after a click (or Enter/Space on the trigger),
 * the composer after Cmd/Ctrl+K. Picking a model always goes to the composer, because the next thing
 * the owner does is type. A click outside leaves focus where the click put it, and a second click on
 * the trigger already has focus on the trigger.
 */
export function focusAfterClose(reason: PickerCloseReason, opener: PickerOpener): PickerFocusTarget {
  if (reason === "outside" || reason === "toggle") {
    return null;
  }
  if (reason === "select") {
    return "composer";
  }
  return opener === "trigger" ? "trigger" : "composer";
}

/**
 * The panel is portalled and only mounts once it has a position, one commit after `open` turns
 * true. Focus has to wait for that commit: a focus call made when `open` is set lands on a search
 * box that does not exist yet, so focus stays on the trigger and Escape never reaches the panel.
 */
export function isPanelMounted(open: boolean, pos: PickerPanelPos | null): boolean {
  return open && pos !== null;
}

function matchesQuery(model: ChatModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    model.label.toLowerCase().includes(q) ||
    model.id.toLowerCase().includes(q) ||
    (model.friendlyLabel?.toLowerCase().includes(q) ?? false) ||
    (model.bestFor?.toLowerCase().includes(q) ?? false)
  );
}

export function ModelPicker({ models, value, onChange, disabled, returnFocusRef }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<PickerPanelPos | null>(null);
  const openerRef = useRef<PickerOpener>("trigger");
  const panelMounted = isPanelMounted(open, pos);

  const selected = models.find((m) => m.id === value) ?? models[0];
  const selectedId = selected?.id ?? "";

  const groups = useMemo((): DisplayGroup[] => {
    const all = pickerGroups(models);
    const q = query.trim();
    if (!q) return all;
    return all
      .map((group) => ({
        ...group,
        models: group.models.filter((m) => matchesQuery(m, q)),
      }))
      .filter((group) => group.models.length > 0);
  }, [models, query]);

  const flat = useMemo(() => {
    const entries: FlatEntry[] = [];
    for (const group of groups) {
      for (const model of group.models) {
        entries.push({ model, optionId: `${listId}-opt-${model.id}` });
      }
    }
    return entries;
  }, [groups, listId]);

  const active = flat[highlight];
  const activeDescendant = open && active ? active.optionId : undefined;

  function focusTarget(target: PickerFocusTarget) {
    if (!target) return;
    // The composer is optional; without one, the trigger is the only sane place to land.
    const element = target === "composer" ? (returnFocusRef?.current ?? triggerRef.current) : triggerRef.current;
    queueMicrotask(() => element?.focus());
  }

  function closePalette(reason: PickerCloseReason) {
    setOpen(false);
    setPos(null);
    setQuery("");
    setHighlight(0);
    focusTarget(focusAfterClose(reason, openerRef.current));
  }

  function openPalette() {
    if (disabled || models.length === 0) return;
    openerRef.current = "trigger";
    setOpen(true);
    const idx = Math.max(
      0,
      flat.findIndex((entry) => entry.model.id === selectedId),
    );
    setHighlight(idx >= 0 ? idx : 0);
  }

  function selectModel(id: string) {
    onChange(id);
    closePalette("select");
  }

  // Cmd/Ctrl+K while this picker (composer) is mounted
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      if (disabled || models.length === 0) {
        return;
      }
      event.preventDefault();
      // Only read when this press opens the palette; a closing press focuses the composer itself.
      openerRef.current = "shortcut";
      setOpen((wasOpen) => {
        if (wasOpen) {
          setQuery("");
          setHighlight(0);
          queueMicrotask(() => returnFocusRef?.current?.focus());
          return false;
        }
        setQuery("");
        return true;
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, models.length, returnFocusRef]);

  // Sync highlight when opening or when the filter changes; prefer current selection
  useEffect(() => {
    if (!open) return;
    const selectedIndex = flat.findIndex((entry) => entry.model.id === selectedId);
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    // flat is derived from query/models; query is the intentional trigger so arrow keys are not reset
  }, [open, query, selectedId, models]);

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePalette("outside");
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // The toolbar clips its left group, so the panel is portalled and placed against the trigger
  useEffect(() => {
    if (!open) {
      return;
    }
    function place() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPos(placePickerPanel(trigger.getBoundingClientRect(), viewportBounds(viewport), viewport));
    }
    place();
    const frame = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Focus the search box once the portalled panel exists (see `isPanelMounted`)
  useEffect(() => {
    if (panelMounted) {
      searchRef.current?.focus();
    }
  }, [panelMounted]);

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flat.length === 0) return;
      setHighlight((i) => (i + 1) % flat.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      setHighlight((i) => (i - 1 + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = flat[highlight];
      if (entry) selectModel(entry.model.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette("escape");
    }
  }

  // Belt and braces: if focus is still on the trigger (a click that landed before the panel
  // mounted, or focus moved back by hand), Escape on the trigger closes the open palette too.
  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      closePalette("escape");
    }
  }

  const triggerLabel = selected ? displayName(selected) : t("chat.models.fallback");

  function renderModelOption(model: ChatModel) {
    const optionId = `${listId}-opt-${model.id}`;
    const flatIndex = flat.findIndex((e) => e.model.id === model.id);
    const isActive = flatIndex === highlight;
    const isSelected = model.id === selectedId;
    const tags = modalityTags(model.inputModalities);
    const name = displayName(model);
    return (
      <li
        key={model.id}
        id={optionId}
        role="option"
        aria-selected={isSelected}
        className={`wash flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
          isActive
            ? "select-row bg-[var(--accent-soft)] text-[var(--text)]"
            : "text-[var(--text)] hover:bg-[var(--accent-soft)]"
        }`}
        onMouseEnter={() => setHighlight(flatIndex)}
        onMouseDown={(event) => {
          event.preventDefault();
          selectModel(model.id);
        }}
      >
        <span className="w-4 shrink-0 text-center" aria-hidden="true">
          {isSelected ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          {model.bestFor ? (
            <span
              data-testid="model-best-for"
              className={`block truncate text-xs ${isActive ? "text-[var(--text-2)]" : "text-[var(--text-3)]"}`}
            >
              {model.bestFor}
            </span>
          ) : null}
        </span>
        {isThinkingModel(model.id) ? (
          <span
            data-testid="model-thinking-badge"
            className={`shrink-0 rounded-lg px-1.5 py-0.5 text-xs uppercase tracking-wide ${
              isActive ? "bg-[var(--surface)] text-[var(--text-2)]" : "border border-[var(--line)] text-[var(--text-3)]"
            }`}
          >
            {t("chat.models.think")}
          </span>
        ) : null}
        {model.contextLength ? (
          <span
            className={`shrink-0 text-xs tabular-nums ${isActive ? "text-[var(--text-2)]" : "text-[var(--text-3)]"}`}
          >
            {formatContextLength(model.contextLength)}
          </span>
        ) : null}
        {tags.length > 0 ? (
          <span className={`shrink-0 text-xs ${isActive ? "text-[var(--text-2)]" : "text-[var(--text-3)]"}`}>
            {tags.join(" · ")}
          </span>
        ) : null}
      </li>
    );
  }

  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="raise fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
            data-testid="model-picker-panel"
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
            role="presentation"
          >
            <div className="border-b border-[var(--line)] p-2">
              <input
                ref={searchRef}
                type="search"
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                placeholder={t("chat.models.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                aria-autocomplete="list"
                autoComplete="off"
              />
            </div>
            <ul
              id={listId}
              role="listbox"
              className="min-h-0 flex-1 overflow-y-auto py-1"
              aria-label={t("chat.models.aria")}
            >
              {flat.length === 0 ? (
                <li className="px-3 py-4 text-sm text-[var(--text-3)]" role="presentation">
                  {query.trim() ? t("chat.models.noMatch", { query: query.trim() }) : t("chat.models.noMatchEmpty")}
                </li>
              ) : (
                groups.map((group) => (
                  <li
                    key={group.label}
                    role="presentation"
                    data-testid={group.label === RECOMMENDED_GROUP ? "model-group-recommended" : undefined}
                  >
                    <div className="px-3 pb-1 pt-2 text-xs font-medium tracking-normal text-[var(--text-3)]">
                      {groupLabel(group.label)}
                    </div>
                    <ul role="group" aria-label={groupLabel(group.label)}>
                      {group.models.map((model) => renderModelOption(model))}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative min-w-[9rem] max-w-[18rem] shrink">
      <button
        ref={triggerRef}
        type="button"
        className="wash inline-flex h-8 w-full min-w-0 items-center overflow-hidden rounded-lg border border-[var(--line)] bg-transparent px-2 text-left text-xs font-medium text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
        data-testid="model-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled || models.length === 0}
        onClick={() => (open ? closePalette("toggle") : openPalette())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="min-w-0 truncate">
          {t("chat.composer.modelPrefix")}: {triggerLabel}
        </span>
      </button>
      {panel}
    </div>
  );
}
