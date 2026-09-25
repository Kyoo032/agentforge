"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import type { PresentationOutline, PresentationShape, PresentationSlide } from "@/lib/presentation-outline";
import { useProductBrand } from "@/lib/product-brand";
import type { JobStudioModel } from "@/lib/use-job-model";
import { t } from "@/lib/i18n";

type ShapeKind = PresentationShape["kind"];

type Props = {
  outline: PresentationOutline;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
  onOutlineChange?: (outline: PresentationOutline) => void;
};

type Drag =
  | { mode: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | {
      mode: "resize";
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    };

const KINDS: ShapeKind[] = ["rectangle", "rounded", "ellipse", "triangle", "line", "arrow", "star", "callout", "text"];
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 5;

const KIND_LABEL: Record<ShapeKind, string> = {
  rectangle: "presentation.addRectangle",
  rounded: "presentation.addRounded",
  ellipse: "presentation.addEllipse",
  triangle: "presentation.addTriangle",
  line: "presentation.addLine",
  arrow: "presentation.addArrow",
  star: "presentation.addStar",
  callout: "presentation.addCallout",
  text: "presentation.addText",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function nextShapeId(): string {
  return `shp${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`.slice(0, 40);
}

function toPercent(stage: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

function placeShape(slide: PresentationSlide, kind: ShapeKind): { slide: PresentationSlide; id: string } {
  if (slide.shapes.length >= 24) {
    return { slide, id: slide.shapes[slide.shapes.length - 1]?.id ?? "" };
  }
  const slot = slide.shapes.length;
  const id = nextShapeId();
  const placed: PresentationShape = {
    id,
    kind,
    x: [4, 58, 78][slot % 3] ?? 4,
    y: clamp(14 + Math.floor(slot / 3) * 30, 0, 70),
    w: kind === "line" || kind === "arrow" || kind === "text" || kind === "callout" ? 26 : 18,
    h: kind === "line" ? 8 : kind === "arrow" ? 12 : kind === "text" ? 12 : 18,
    text: kind === "text" ? "" : "",
    fill: kind === "text" ? "FFFFFF" : "F7F7F6",
    stroke: "0F766E",
  };
  return { slide: { ...slide, shapes: [...slide.shapes, placed] }, id };
}

function EditableText({
  value,
  testId,
  className,
  label,
  onCommit,
}: {
  value: string;
  testId: string;
  className: string;
  label: string;
  onCommit: (next: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) {
      return;
    }
    if (node.innerText !== value) {
      node.innerText = value;
    }
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-testid={testId}
      className={className}
      onBlur={(event) => {
        const next = event.currentTarget.innerText.replace(/\s+$/g, "");
        onCommit(next.trim() ? next : " ");
      }}
    />
  );
}

function ShapeGlyph({ shape }: { shape: PresentationShape }) {
  const fill = `#${shape.fill}`;
  const stroke = `#${shape.stroke}`;
  const paint = { fill, stroke, strokeWidth: 3 };
  if (shape.kind === "ellipse") {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <ellipse cx="50" cy="50" rx="46" ry="46" {...paint} />
      </svg>
    );
  }
  if (shape.kind === "triangle") {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <polygon points="50,6 96,94 4,94" {...paint} />
      </svg>
    );
  }
  if (shape.kind === "line") {
    return (
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <line x1="0" y1="10" x2="100" y2="10" stroke={stroke} strokeWidth="4" />
      </svg>
    );
  }
  if (shape.kind === "arrow") {
    return (
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <polygon points="0,12 68,12 68,2 100,20 68,38 68,28 0,28" {...paint} />
      </svg>
    );
  }
  if (shape.kind === "star") {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <polygon points="50,4 61,36 96,36 68,56 79,92 50,72 21,92 32,56 4,36 39,36" {...paint} />
      </svg>
    );
  }
  if (shape.kind === "callout") {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <path d="M6,8 H90 Q96,8 96,16 V58 Q96,66 88,66 H42 L22,94 L34,66 H14 Q6,66 6,58 V16 Q6,8 14,8 Z" {...paint} />
      </svg>
    );
  }
  if (shape.kind === "text") {
    return (
      <div className="flex h-full w-full items-center justify-center px-1 text-center text-sm" style={{ color: stroke }}>
        {shape.text}
      </div>
    );
  }
  return (
    <div
      className="h-full w-full"
      style={{ background: fill, border: `2px solid ${stroke}`, borderRadius: shape.kind === "rounded" ? 16 : 2 }}
    />
  );
}

export function PresentationPreview({
  outline,
  models = [],
  defaultModel = "",
  regeneratingIndex = null,
  onRegenerate,
  onOutlineChange,
}: Props) {
  const { productName } = useProductBrand();
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const total = outline.slides.length + 1;
  const contentIndex = slideIndex === 0 ? -1 : slideIndex - 1;
  const slide = contentIndex >= 0 ? outline.slides[contentIndex] : null;
  const selected = slide?.shapes.find((shape) => shape.id === selectedId) ?? null;
  const editable = Boolean(onOutlineChange);

  useEffect(() => {
    setSlideIndex(0);
    setSelectedId(null);
    setRegenOpen(false);
  }, [outline.title, outline.slides.length]);

  function commitOutline(next: PresentationOutline) {
    onOutlineChange?.(next);
  }

  function replaceSlide(index: number, next: PresentationSlide) {
    commitOutline({
      ...outline,
      slides: outline.slides.map((item, itemIndex) => (itemIndex === index ? next : item)),
    });
  }

  function updateShape(id: string, patch: Partial<PresentationShape>) {
    if (!slide || contentIndex < 0) {
      return;
    }
    replaceSlide(contentIndex, {
      ...slide,
      shapes: slide.shapes.map((shape) => (shape.id === id ? { ...shape, ...patch } : shape)),
    });
  }

  function removeSelected() {
    if (!slide || !selected || contentIndex < 0) {
      return;
    }
    replaceSlide(contentIndex, {
      ...slide,
      shapes: slide.shapes.filter((shape) => shape.id !== selected.id),
    });
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!slide || !selected || contentIndex < 0 || slide.shapes.length >= 24) {
      return;
    }
    const id = nextShapeId();
    const copy: PresentationShape = {
      ...selected,
      id,
      x: clamp(round1(selected.x + 3), 0, 100 - selected.w),
      y: clamp(round1(selected.y + 3), 0, 100 - selected.h),
    };
    replaceSlide(contentIndex, { ...slide, shapes: [...slide.shapes, copy] });
    setSelectedId(id);
  }

  function addKind(kind: ShapeKind) {
    const index = contentIndex < 0 ? 0 : contentIndex;
    const current = outline.slides[index];
    if (!current) {
      return;
    }
    const placed = placeShape(current, kind);
    replaceSlide(index, placed.slide);
    setSlideIndex(index + 1);
    setSelectedId(placed.id);
  }

  useEffect(() => {
    function move(event: PointerEvent) {
      const drag = dragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage || contentIndex < 0) {
        return;
      }
      const current = outline.slides[contentIndex];
      const shape = current?.shapes.find((item) => item.id === drag.id);
      if (!current || !shape) {
        return;
      }
      const point = toPercent(stage, event.clientX, event.clientY);
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const patch =
        drag.mode === "move"
          ? {
              x: clamp(round1(drag.origX + dx), 0, 100 - shape.w),
              y: clamp(round1(drag.origY + dy), 0, 100 - shape.h),
            }
          : {
              w: clamp(round1(drag.origW + dx), 4, 100 - drag.origX),
              h: clamp(round1(drag.origH + dy), 4, 100 - drag.origY),
            };
      onOutlineChange?.({
        ...outline,
        slides: outline.slides.map((item, index) =>
          index === contentIndex
            ? { ...item, shapes: item.shapes.map((entry) => (entry.id === drag.id ? { ...entry, ...patch } : entry)) }
            : item,
        ),
      });
    }
    function up() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [outline, contentIndex, onOutlineChange]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!editable || !selected || !onOutlineChange || contentIndex < 0) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      const current = outline.slides[contentIndex];
      if (!current) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onOutlineChange({
          ...outline,
          slides: outline.slides.map((item, index) =>
            index === contentIndex
              ? { ...item, shapes: item.shapes.filter((shape) => shape.id !== selected.id) }
              : item,
          ),
        });
        setSelectedId(null);
        return;
      }
      const direction: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const vector = direction[event.key];
      if (!vector) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      const patch = {
        x: clamp(round1(selected.x + vector[0] * step), 0, 100 - selected.w),
        y: clamp(round1(selected.y + vector[1] * step), 0, 100 - selected.h),
      };
      onOutlineChange({
        ...outline,
        slides: outline.slides.map((item, index) =>
          index === contentIndex
            ? {
                ...item,
                shapes: item.shapes.map((shape) => (shape.id === selected.id ? { ...shape, ...patch } : shape)),
              }
            : item,
        ),
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, selected, contentIndex, outline, onOutlineChange]);

  function beginDrag(event: ReactPointerEvent, shape: PresentationShape, mode: Drag["mode"]) {
    if (!editable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const point = toPercent(stage, event.clientX, event.clientY);
    dragRef.current =
      mode === "move"
        ? { mode, id: shape.id, startX: point.x, startY: point.y, origX: shape.x, origY: shape.y }
        : {
            mode,
            id: shape.id,
            startX: point.x,
            startY: point.y,
            origX: shape.x,
            origY: shape.y,
            origW: shape.w,
            origH: shape.h,
          };
    setSelectedId(shape.id);
  }

  function endDrag() {
    dragRef.current = null;
  }

  const bullets = slide && slide.bullets.length > 0 ? slide.bullets : [""];

  return (
    <div className="flex flex-col gap-3" data-testid="presentations-preview">
      <p className="text-sm text-[var(--text-2)]" data-testid="presentations-edit-note">
        {t("presentation.editNote")}
      </p>
      <div
        className="grid grid-cols-1 gap-3 lg:grid-cols-[9.5rem_minmax(0,1fr)_15rem]"
        data-testid="presentations-editor"
      >
        <div className="flex flex-wrap gap-1 lg:col-span-3" data-testid="presentations-shape-toolbar">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-2.5 text-xs"
              data-testid={`presentations-add-${kind === "rounded" ? "rounded" : kind}`}
              disabled={!editable}
              onClick={() => addKind(kind)}
            >
              {t(KIND_LABEL[kind])}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" data-testid="presentations-filmstrip">
          <button
            type="button"
            className={`wash min-w-28 rounded-lg border px-2 py-2 text-left text-xs ${slideIndex === 0 ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
            data-testid="presentations-filmstrip-slide"
            aria-pressed={slideIndex === 0}
            onClick={() => {
              setSlideIndex(0);
              setSelectedId(null);
            }}
          >
            <span className="block truncate font-medium">{outline.title}</span>
            <span className="text-[var(--text-3)]">1 / {total}</span>
          </button>
          {outline.slides.map((item, index) => (
            <button
              key={item.heading + String(index)}
              type="button"
              className={`wash min-w-28 rounded-lg border px-2 py-2 text-left text-xs ${slideIndex === index + 1 ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
              data-testid="presentations-filmstrip-slide"
              aria-pressed={slideIndex === index + 1}
              onClick={() => {
                setSlideIndex(index + 1);
                setSelectedId(null);
                setRegenOpen(false);
              }}
            >
              <span className="block truncate font-medium">{item.heading}</span>
              <span className="text-[var(--text-3)]">
                {index + 2} / {total}
              </span>
            </button>
          ))}
        </div>

        <div
          ref={stageRef}
          className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]"
          data-testid={slide ? "presentations-slide" : "presentations-slide-title"}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-testid='presentations-shape']")) {
              setSelectedId(null);
            }
          }}
        >
          <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
          {slide ? (
            <div className="relative flex h-full flex-col px-8 py-7 sm:px-12">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
                {t("presentation.kicker")}
              </p>
              {editable ? (
                <EditableText
                  value={slide.heading}
                  testId="presentations-edit-heading"
                  label={t("presentation.editHeading")}
                  className="mt-2 max-w-3xl text-2xl font-medium leading-tight outline-none"
                  onCommit={(next) => replaceSlide(contentIndex, { ...slide, heading: next })}
                />
              ) : (
                <h2 className="mt-2 max-w-3xl text-2xl font-medium" data-testid="presentations-edit-heading">
                  {slide.heading}
                </h2>
              )}
              <ul className="mt-4 max-w-3xl list-disc space-y-1.5 pl-5 text-sm" data-testid="presentations-edit-bullets">
                {bullets.map((bullet, index) => (
                  <li key={`${index}-${bullet.slice(0, 24)}`}>
                    {editable ? (
                      <EditableText
                        value={bullet}
                        testId="presentations-edit-bullet"
                        label={t("presentation.editBullets")}
                        className="outline-none"
                        onCommit={(next) => {
                          const nextBullets = bullets.slice();
                          nextBullets[index] = next.trim();
                          replaceSlide(contentIndex, {
                            ...slide,
                            bullets: nextBullets.filter((item) => item.length > 0),
                          });
                        }}
                      />
                    ) : (
                      bullet
                    )}
                  </li>
                ))}
              </ul>
              {slide.aside.trim() ? (
                <p className="mt-auto max-w-sm self-end rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">{slide.aside}</p>
              ) : null}
            </div>
          ) : (
            <div className="relative flex h-full flex-col justify-center px-8 py-10 sm:px-12">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
                {t("presentation.kicker")}
              </p>
              {editable ? (
                <EditableText
                  value={outline.title}
                  testId="presentations-edit-title"
                  label={t("presentation.editTitle")}
                  className="mt-3 max-w-3xl text-3xl font-medium leading-tight outline-none"
                  onCommit={(next) => commitOutline({ ...outline, title: next })}
                />
              ) : (
                <h2 className="mt-3 text-3xl font-medium" data-testid="presentations-edit-title">
                  {outline.title}
                </h2>
              )}
            </div>
          )}
          {slide?.shapes.map((shape) => (
            <div
              key={shape.id}
              data-testid="presentations-shape"
              data-kind={shape.kind}
              data-x={shape.x}
              data-y={shape.y}
              data-w={shape.w}
              data-h={shape.h}
              className="absolute touch-none"
              style={{
                left: `${shape.x}%`,
                top: `${shape.y}%`,
                width: `${shape.w}%`,
                height: `${shape.h}%`,
                outline: shape.id === selectedId ? "2px solid var(--accent)" : undefined,
                zIndex: shape.id === selectedId ? 3 : 2,
              }}
              onPointerDown={(event) => beginDrag(event, shape, "move")}
            >
              <ShapeGlyph shape={shape} />
              {shape.kind !== "text" && shape.text ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-1 text-center text-[10px]">
                  {shape.text}
                </span>
              ) : null}
              {editable && shape.id === selectedId ? (
                <button
                  type="button"
                  aria-label={t("presentation.resizeShape")}
                  data-testid="presentations-shape-resize"
                  className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm bg-[var(--accent)]"
                  onPointerDown={(event) => beginDrag(event, shape, "resize")}
                />
              ) : null}
            </div>
          ))}
          <p className="pointer-events-none absolute bottom-3 left-8 text-xs text-[var(--text-3)] sm:left-12">{productName}</p>
          <p className="pointer-events-none absolute bottom-3 right-4 text-xs text-[var(--text-3)]">
            {slideIndex + 1} / {total}
          </p>
        </div>

        <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="presentations-properties">
          <p className="text-xs font-medium text-[var(--text-2)]">{t("presentation.properties")}</p>
          {selected && slide ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm">{t(KIND_LABEL[selected.kind])}</p>
              <label className="flex items-center justify-between gap-2 text-xs text-[var(--text-2)]">
                {t("presentation.fill")}
                <input
                  type="color"
                  data-testid="presentations-fill"
                  value={`#${selected.fill}`}
                  onChange={(event) => updateShape(selected.id, { fill: event.target.value.slice(1).toUpperCase() })}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-[var(--text-2)]">
                {t("presentation.stroke")}
                <input
                  type="color"
                  data-testid="presentations-stroke"
                  value={`#${selected.stroke}`}
                  onChange={(event) => updateShape(selected.id, { stroke: event.target.value.slice(1).toUpperCase() })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--text-2)]">
                {t("presentation.shapeText")}
                <input
                  className="text-field"
                  data-testid="presentations-shape-text"
                  value={selected.text}
                  onChange={(event) => updateShape(selected.id, { text: event.target.value.slice(0, 200) })}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                  data-testid="presentations-shape-duplicate"
                  disabled={slide.shapes.length >= 24}
                  onClick={duplicateSelected}
                >
                  {t("presentation.duplicateShape")}
                </button>
                <button
                  type="button"
                  className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                  data-testid="presentations-shape-remove"
                  onClick={removeSelected}
                >
                  {t("presentation.removeShape")}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-3)]">{t("presentation.noShape")}</p>
          )}
          {slide && editable ? (
            <label className="mt-4 grid gap-1 text-xs text-[var(--text-2)]">
              {t("presentation.editNotes")}
              <textarea
                className="text-field min-h-20"
                data-testid="presentations-edit-notes"
                value={slide.notes}
                onChange={(event) => replaceSlide(contentIndex, { ...slide, notes: event.target.value })}
              />
            </label>
          ) : null}
          {slide && onRegenerate ? (
            <div className="mt-3">
              <button
                type="button"
                className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                data-testid="presentations-regen"
                aria-expanded={regenOpen}
                onClick={() => setRegenOpen((open) => !open)}
              >
                {regeneratingIndex === contentIndex ? t("presentation.regenerating") : t("presentation.regenerate")}
              </button>
              {regenOpen ? (
                <JobRegenPanel
                  testIdPrefix="presentations"
                  models={models}
                  defaultModel={defaultModel}
                  submitting={regeneratingIndex === contentIndex}
                  disabled={regeneratingIndex !== null && regeneratingIndex !== contentIndex}
                  onCancel={() => setRegenOpen(false)}
                  onSubmit={(payload) => onRegenerate(contentIndex, payload)}
                />
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
