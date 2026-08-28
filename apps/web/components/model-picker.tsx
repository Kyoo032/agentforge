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
import { formatContextLength, pickerGroups } from "@agentforge/core/preferred";

export type ChatModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
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

function modalityTags(mods: string[]): string[] {
  const extra = mods.filter((m) => m !== "text");
  return extra.length > 0 ? extra : [];
}

function matchesQuery(model: ChatModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return model.label.toLowerCase().includes(q) || model.id.toLowerCase().includes(q);
}

export function ModelPicker({ models, value, onChange, disabled, returnFocusRef }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = models.find((m) => m.id === value) ?? models[0];
  const selectedId = selected?.id ?? "";

  const groups = useMemo(() => {
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

  function closePalette(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    setHighlight(0);
    if (returnFocus) {
      queueMicrotask(() => {
        returnFocusRef?.current?.focus();
      });
    }
  }

  function openPalette() {
    if (disabled || models.length === 0) return;
    setOpen(true);
    const idx = Math.max(
      0,
      flat.findIndex((entry) => entry.model.id === selectedId),
    );
    setHighlight(idx >= 0 ? idx : 0);
    queueMicrotask(() => searchRef.current?.focus());
  }

  function selectModel(id: string) {
    onChange(id);
    closePalette(true);
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
      setOpen((wasOpen) => {
        if (wasOpen) {
          setQuery("");
          setHighlight(0);
          queueMicrotask(() => returnFocusRef?.current?.focus());
          return false;
        }
        setQuery("");
        queueMicrotask(() => searchRef.current?.focus());
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
      closePalette(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Autofocus search when opened
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

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
      closePalette(true);
    }
  }

  const triggerLabel = selected?.label ?? "Model";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="max-w-[14rem] truncate rounded-full border border-mist bg-paper px-3 py-1.5 text-left text-sm text-ink disabled:opacity-50"
        data-testid="model-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled || models.length === 0}
        onClick={() => (open ? closePalette(false) : openPalette())}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-mist bg-paper"
          role="presentation"
        >
          <div className="border-b border-mist p-2">
            <input
              ref={searchRef}
              type="search"
              className="w-full rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-navy"
              placeholder="Search models"
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
            className="max-h-72 overflow-y-auto py-1"
            aria-label="Models"
          >
            {flat.length === 0 ? (
              <li className="px-3 py-4 text-sm text-ink/60" role="presentation">
                No models matching {query.trim() ? `“${query.trim()}”` : "your search"}
              </li>
            ) : (
              groups.map((group) => (
                <li key={group.label} role="presentation">
                  <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink/50">
                    {group.label}
                  </div>
                  <ul role="group" aria-label={group.label}>
                    {group.models.map((model) => {
                      const optionId = `${listId}-opt-${model.id}`;
                      const flatIndex = flat.findIndex((e) => e.model.id === model.id);
                      const isActive = flatIndex === highlight;
                      const isSelected = model.id === selectedId;
                      const tags = modalityTags(model.inputModalities);
                      return (
                        <li
                          key={model.id}
                          id={optionId}
                          role="option"
                          aria-selected={isSelected}
                          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                            isActive ? "bg-navy text-white" : "text-ink hover:bg-mist"
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
                          <span className="min-w-0 flex-1 truncate">{model.label}</span>
                          {model.contextLength ? (
                            <span
                              className={`shrink-0 text-xs tabular-nums ${isActive ? "text-white/80" : "text-ink/50"}`}
                            >
                              {formatContextLength(model.contextLength)}
                            </span>
                          ) : null}
                          {tags.length > 0 ? (
                            <span
                              className={`shrink-0 text-xs ${isActive ? "text-white/80" : "text-ink/50"}`}
                            >
                              {tags.join(" · ")}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
