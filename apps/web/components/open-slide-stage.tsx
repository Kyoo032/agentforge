"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  type OpenSlidePage,
} from "@agentforge/core/open-slide";
import { assignSlideLayout } from "@agentforge/core";
import { t } from "@/lib/i18n";

function pageLayout(page: OpenSlidePage, index: number): string {
  if (page.layout) {
    return page.layout;
  }
  const texts = page.blocks.filter((block) => block.kind === "text" && block.text.trim());
  const title = texts.reduce<OpenSlideBlock | undefined>(
    (best, block) => (!best || block.fontSize > best.fontSize ? block : best),
    undefined,
  );
  return assignSlideLayout(
    { role: page.role, lines: texts.filter((block) => block !== title).map((block) => block.text) },
    index,
  );
}

export function OpenSlideStage({ deck, onChange }: { deck: OpenSlideDeck; onChange: (next: OpenSlideDeck) => void }) {
  const [pageId, setPageId] = useState(deck.pages[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const deckRef = useRef(deck);
  deckRef.current = deck;
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, block: OpenSlideBlock) {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("textarea, input")) {
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
    const currentPageId = page.id;
    let dragging = false;
    function move(ev: PointerEvent) {
      const dx = ev.clientX - originX;
      const dy = ev.clientY - originY;
      // A click jitters by a pixel. Ignore that, and read the latest deck so the
      // move does not put back text from the pointer-down render.
      if (!dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        dragging = true;
      }
      onChange(moveOpenSlideBlock(deckRef.current, currentPageId, block.id, startX + dx / scale, startY + dy / scale));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="presentations-open-slide">
      <div className="flex gap-1 overflow-x-auto" data-testid="presentations-open-slide-filmstrip">
        {deck.pages.map((item, index) => {
          const label = item.blocks.find((block) => block.kind === "text" && block.text.trim())?.text ?? item.role;
          return (
            <button
              key={item.id}
              type="button"
              className="h-8 max-w-36 shrink-0 truncate rounded-lg border border-[var(--line)] px-2 text-left text-xs"
              data-testid="presentations-open-slide-page"
              data-role={item.role}
              data-layout={pageLayout(item, index)}
              aria-current={item.id === page.id ? "true" : undefined}
              onClick={() => selectPage(item.id)}
            >
              {index + 1}. {label}
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
        data-layout={
          page
            ? pageLayout(
                page,
                Math.max(
                  0,
                  deck.pages.findIndex((item) => item.id === page.id),
                ),
              )
            : "title"
        }
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <div
            className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1"
            data-testid="presentations-open-slide-toolbar"
          >
            <label className="flex items-center gap-1 text-xs text-[var(--text-2)]">
              {t("presentation.openSlideAccent")}
              <input
                type="color"
                value={deck.design.palette.accent}
                aria-label={t("presentation.openSlideAccent")}
                data-testid="presentations-open-slide-accent"
                onChange={(event) => onChange(setOpenSlideAccent(deck, event.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost h-8 rounded-lg px-2 text-xs"
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
              className="btn btn-ghost h-8 rounded-lg px-2 text-xs"
              disabled={!selected}
              data-testid="presentations-open-slide-duplicate"
              onClick={() => {
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
            <button
              type="button"
              className="btn btn-ghost h-8 rounded-lg px-2 text-xs"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
            >
              {t("presentation.openSlideNotes")}
            </button>
          </div>
        ) : null}
        {selected && notesOpen ? (
          <label className="absolute right-3 top-14 z-20 w-56 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-xs text-[var(--text-2)]">
            {t("presentation.openSlideNotes")}
            <textarea
              className="text-field mt-1 min-h-20"
              value={page.notes}
              aria-label={t("presentation.openSlideNotes")}
              data-testid="presentations-open-slide-notes"
              onChange={(event) => onChange(setOpenSlidePageNotes(deck, page.id, event.target.value))}
            />
          </label>
        ) : null}
        {page.blocks.map((block) => {
          const active = selected?.id === block.id;
          return (
            <div
              key={block.id}
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
                border: active ? "2px solid #0f766e" : "2px solid transparent",
                padding: 0,
              }}
              data-testid="presentations-open-slide-block"
              data-kind={block.kind}
              data-x={block.x}
              data-y={block.y}
              data-selected={active ? "true" : "false"}
              onPointerDown={(event) => onPointerDown(event, block)}
            >
              {active && block.kind === "text" ? (
                <textarea
                  className="h-full w-full resize-none bg-transparent outline-none"
                  style={{ color: "inherit", font: "inherit", textAlign: "inherit" }}
                  value={block.text}
                  aria-label={t("presentation.openSlideText")}
                  data-testid="presentations-open-slide-text"
                  onChange={(event) => onChange(setOpenSlideBlockText(deck, page.id, block.id, event.target.value))}
                />
              ) : block.kind === "text" ? (
                block.text
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
