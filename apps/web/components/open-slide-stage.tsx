"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  addOpenSlideTextBlock,
  duplicateOpenSlideBlock,
  moveOpenSlideBlock,
  nudgeOpenSlideBlock,
  OPEN_SLIDE_CANVAS_HEIGHT,
  OPEN_SLIDE_CANVAS_WIDTH,
  OPEN_SLIDE_NUDGE_PX,
  OPEN_SLIDE_NUDGE_SHIFT_PX,
  removeOpenSlideBlock,
  setOpenSlideAccent,
  setOpenSlideBlockText,
  setOpenSlidePageNotes,
  toneColor,
  type OpenSlideBlock,
  type OpenSlideDeck,
} from "@agentforge/core/open-slide";
import { t } from "@/lib/i18n";

export function OpenSlideStage({ deck, onChange }: { deck: OpenSlideDeck; onChange: (next: OpenSlideDeck) => void }) {
  const [pageId, setPageId] = useState(deck.pages[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const page = deck.pages.find((item) => item.id === pageId) ?? deck.pages[0];
  const selected = page?.blocks.find((block) => block.id === selectedId) ?? null;

  if (!page) {
    return null;
  }

  function selectPage(id: string) {
    setPageId(id);
    setSelectedId(null);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!page || !selected) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onChange(removeOpenSlideBlock(deck, page.id, selected.id));
      return;
    }
    const step = event.shiftKey ? OPEN_SLIDE_NUDGE_SHIFT_PX : OPEN_SLIDE_NUDGE_PX;
    const delta =
      event.key === "ArrowRight"
        ? [step, 0]
        : event.key === "ArrowLeft"
          ? [-step, 0]
          : event.key === "ArrowDown"
            ? [0, step]
            : event.key === "ArrowUp"
              ? [0, -step]
              : null;
    if (!delta) {
      return;
    }
    event.preventDefault();
    onChange(nudgeOpenSlideBlock(deck, page.id, selected.id, delta[0], delta[1]));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, block: OpenSlideBlock) {
    if (event.button !== 0) {
      return;
    }
    setSelectedId(block.id);
    const stage = event.currentTarget.parentElement;
    if (!stage) {
      return;
    }
    const scale = stage.getBoundingClientRect().width / OPEN_SLIDE_CANVAS_WIDTH;
    const originX = event.clientX;
    const originY = event.clientY;
    const startX = block.x;
    const startY = block.y;
    const snapshot = deck;
    const currentPageId = page.id;
    function move(ev: PointerEvent) {
      onChange(
        moveOpenSlideBlock(
          snapshot,
          currentPageId,
          block.id,
          startX + (ev.clientX - originX) / scale,
          startY + (ev.clientY - originY) / scale,
        ),
      );
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]" data-testid="presentations-open-slide">
      <div className="flex flex-col gap-2" data-testid="presentations-open-slide-filmstrip">
        {deck.pages.map((item, index) => {
          const label = item.blocks.find((block) => block.kind === "text" && block.text.trim())?.text ?? item.role;
          return (
            <button
              key={item.id}
              type="button"
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-left"
              data-testid="presentations-open-slide-page"
              data-role={item.role}
              aria-current={item.id === page.id ? "true" : undefined}
              onClick={() => selectPage(item.id)}
            >
              <span className="text-xs text-[var(--text-3)]">{index + 1}</span>
              <span className="mt-1 block truncate text-sm text-[var(--text)]">{label}</span>
            </button>
          );
        })}
      </div>
      <div
        className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] outline-none"
        style={{
          aspectRatio: `${OPEN_SLIDE_CANVAS_WIDTH} / ${OPEN_SLIDE_CANVAS_HEIGHT}`,
          background: deck.design.palette.bg,
          containerType: "inline-size",
        }}
        tabIndex={0}
        data-testid="presentations-open-slide-stage"
        data-page={page.role}
        onKeyDown={onKeyDown}
      >
        {page.blocks.map((block) => (
          <button
            key={block.id}
            type="button"
            className="absolute overflow-hidden text-left"
            style={{
              left: `${(block.x / OPEN_SLIDE_CANVAS_WIDTH) * 100}%`,
              top: `${(block.y / OPEN_SLIDE_CANVAS_HEIGHT) * 100}%`,
              width: `${(block.w / OPEN_SLIDE_CANVAS_WIDTH) * 100}%`,
              height: `${(block.h / OPEN_SLIDE_CANVAS_HEIGHT) * 100}%`,
              color: toneColor(deck.design, block.tone),
              background: block.kind === "shape" ? toneColor(deck.design, block.tone) : "transparent",
              fontSize: `${(block.fontSize / OPEN_SLIDE_CANVAS_WIDTH) * 100}cqw`,
              fontWeight: block.weight,
              textAlign: block.align,
              lineHeight: 1.2,
              border: selected?.id === block.id ? "2px solid #0f766e" : "2px solid transparent",
              padding: 0,
            }}
            data-testid="presentations-open-slide-block"
            data-kind={block.kind}
            data-x={block.x}
            data-y={block.y}
            data-selected={selected?.id === block.id ? "true" : "false"}
            onPointerDown={(event) => onPointerDown(event, block)}
          >
            {block.kind === "text" ? block.text : null}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3" data-testid="presentations-open-slide-properties">
        <p className="text-xs text-[var(--text-2)]" data-testid="presentations-open-slide-brief">
          {deck.brief.aesthetic}
        </p>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          {t("presentation.openSlideAccent")}
          <input
            type="color"
            value={deck.design.palette.accent}
            aria-label={t("presentation.openSlideAccent")}
            data-testid="presentations-open-slide-accent"
            onChange={(event) => onChange(setOpenSlideAccent(deck, event.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          {t("presentation.openSlideText")}
          <textarea
            className="text-field min-h-24"
            value={selected?.text ?? ""}
            disabled={selected?.kind !== "text"}
            aria-label={t("presentation.openSlideText")}
            data-testid="presentations-open-slide-text"
            onChange={(event) => {
              if (selected) {
                onChange(setOpenSlideBlockText(deck, page.id, selected.id, event.target.value));
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          {t("presentation.openSlideNotes")}
          <textarea
            className="text-field min-h-24"
            value={page.notes}
            aria-label={t("presentation.openSlideNotes")}
            data-testid="presentations-open-slide-notes"
            onChange={(event) => onChange(setOpenSlidePageNotes(deck, page.id, event.target.value))}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
            data-testid="presentations-open-slide-add-text"
            onClick={() => {
              const next = addOpenSlideTextBlock(deck, page.id);
              onChange(next);
              const added = next.pages.find((item) => item.id === page.id)?.blocks.at(-1);
              if (added) {
                setSelectedId(added.id);
              }
            }}
          >
            {t("presentation.openSlideAddText")}
          </button>
          <button
            type="button"
            className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
            disabled={!selected}
            data-testid="presentations-open-slide-duplicate"
            onClick={() => {
              if (!selected) {
                return;
              }
              const next = duplicateOpenSlideBlock(deck, page.id, selected.id);
              onChange(next);
              const copy = next.pages.find((item) => item.id === page.id)?.blocks.at(-1);
              if (copy && copy.id !== selected.id) {
                setSelectedId(copy.id);
              }
            }}
          >
            {t("presentation.openSlideDuplicate")}
          </button>
        </div>
      </div>
    </div>
  );
}
