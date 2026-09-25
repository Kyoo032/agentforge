"use client";

import { useState, type ReactNode } from "react";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import {
  resolvePresentationSlideLayout,
  type PresentationOutline,
  type PresentationShape,
  type PresentationSlide,
} from "@/lib/presentation-outline";
import { useProductBrand } from "@/lib/product-brand";
import type { JobStudioModel } from "@/lib/use-job-model";
import { t } from "@/lib/i18n";

type Props = {
  outline: PresentationOutline;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
  onOutlineChange?: (outline: PresentationOutline) => void;
};

function shapeStyle(shape: PresentationShape): {
  left: string;
  top: string;
  width: string;
  height: string;
  borderRadius?: string;
} {
  return {
    left: `${shape.x}%`,
    top: `${shape.y}%`,
    width: `${shape.w}%`,
    height: `${shape.h}%`,
    borderRadius: shape.kind === "ellipse" ? "999px" : "4px",
  };
}

function ShapeMarks({ shapes }: { shapes: PresentationSlide["shapes"] }) {
  if (shapes.length === 0) {
    return null;
  }
  return (
    <>
      {shapes.map((shape) => (
        <div
          key={shape.id}
          data-testid="presentations-shape"
          data-kind={shape.kind}
          className="pointer-events-none absolute flex items-center justify-center overflow-hidden border border-[var(--accent)] bg-[var(--bg)] px-1 text-center text-[10px] leading-tight text-[var(--text)]"
          style={shapeStyle(shape)}
        >
          {shape.text}
        </div>
      ))}
    </>
  );
}

function nextShapeId(): string {
  return `shp${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`.slice(0, 40);
}

function addShape(slide: PresentationSlide, kind: PresentationShape["kind"]): PresentationSlide {
  if (slide.shapes.length >= 24) {
    return slide;
  }
  const offset = (slide.shapes.length % 6) * 4;
  const placed: PresentationShape = {
    id: nextShapeId(),
    kind,
    x: kind === "text" ? 58 : kind === "ellipse" ? 40 : 8,
    y: Math.min(70, 58 + offset),
    w: kind === "ellipse" ? 16 : kind === "text" ? 28 : 26,
    h: kind === "ellipse" ? 18 : 14,
    text: kind === "text" ? "" : "",
  };
  return { ...slide, shapes: [...slide.shapes, placed] };
}

function SlideShell({
  children,
  productName,
  page,
  regen,
  shapes,
}: {
  children: ReactNode;
  productName: string;
  page: string;
  regen: ReactNode;
  shapes: PresentationSlide["shapes"];
}) {
  return (
    <article
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
      data-testid="presentations-slide"
    >
      <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
      <div className="absolute right-8 top-6 sm:right-12">{regen}</div>
      <ShapeMarks shapes={shapes} />
      <div className="flex h-full flex-col px-8 pb-12 pt-7 sm:px-12 sm:pb-14 sm:pt-10">{children}</div>
      <p className="absolute bottom-4 left-8 text-xs font-medium text-[var(--text-3)] sm:left-12">{productName}</p>
      <p className="absolute bottom-4 right-8 text-xs font-medium text-[var(--text-3)] sm:right-12">{page}</p>
    </article>
  );
}

function SlideBody({ slide }: { slide: PresentationSlide }) {
  if (slide.kind === "section") {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center pr-24">
        <h3 className="max-w-4xl text-3xl font-medium leading-tight tracking-[var(--track)] text-[var(--text)]">
          {slide.heading}
        </h3>
        {slide.subhead.trim() ? <p className="mt-4 max-w-3xl text-base text-[var(--text-2)]">{slide.subhead}</p> : null}
        {slide.bullets.length > 0 ? (
          <ul className="mt-6 max-w-3xl list-disc space-y-2 pl-5 text-sm text-[var(--text-2)]">
            {slide.bullets.map((bullet) => (
              <li key={bullet}>
                <FormattedText text={bullet} inline />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pr-24 pt-2">
      <h3 className="text-2xl font-medium leading-tight tracking-[var(--track)] text-[var(--text)]">{slide.heading}</h3>
      {slide.subhead.trim() ? <p className="mt-2 text-sm text-[var(--text-2)]">{slide.subhead}</p> : null}
      {slide.kind === "close" ? <div className="mt-4 h-0.5 w-16 bg-[var(--accent)]" /> : null}
      {slide.kind === "split" ? (
        <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
          <ul className="list-disc space-y-2.5 pl-5 text-sm text-[var(--text-2)]">
            {slide.bullets.map((bullet) => (
              <li key={bullet}>
                <FormattedText text={bullet} inline />
              </li>
            ))}
          </ul>
          <div className="self-start rounded-xl bg-[var(--bg)] px-5 py-5 text-sm leading-relaxed text-[var(--text)]">
            <FormattedText text={slide.aside} inline />
          </div>
        </div>
      ) : slide.bullets.length > 0 ? (
        <ul className="mt-5 max-w-3xl list-disc space-y-2.5 pl-5 text-sm text-[var(--text-2)]">
          {slide.bullets.map((bullet) => (
            <li key={bullet}>
              <FormattedText text={bullet} inline />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-[var(--text-3)]">{t("presentation.noBullets")}</p>
      )}
    </div>
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
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const total = outline.slides.length + 1;

  function replaceSlide(index: number, next: PresentationSlide) {
    onOutlineChange?.({
      ...outline,
      slides: outline.slides.map((slide, slideIndex) => (slideIndex === index ? next : slide)),
    });
  }

  return (
    <div
      className="flex flex-col gap-4 min-[1600px]:grid min-[1600px]:grid-cols-2 min-[1600px]:items-start"
      data-testid="presentations-preview"
    >
      {onOutlineChange ? (
        <p className="text-sm text-[var(--text-2)] min-[1600px]:col-span-2" data-testid="presentations-edit-note">
          {t("presentation.editNote")}
        </p>
      ) : null}
      <article
        className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]"
        data-testid="presentations-slide-title"
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
        <div className="relative flex h-full flex-col justify-center px-8 py-10 sm:px-12">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
            {t("presentation.title")}
          </p>
          {onOutlineChange ? (
            <input
              className="text-field mt-3 max-w-3xl text-2xl font-medium"
              value={outline.title}
              aria-label={t("presentation.editTitle")}
              data-testid="presentations-edit-title"
              onChange={(event) => onOutlineChange({ ...outline, title: event.target.value || " " })}
            />
          ) : (
            <h2 className="mt-3 max-w-3xl text-2xl font-medium leading-tight tracking-[var(--track)] text-[var(--text)]">
              {outline.title}
            </h2>
          )}
          <p className="absolute bottom-4 left-8 text-xs font-medium text-[var(--text-3)] sm:left-12">{productName}</p>
          <p className="absolute bottom-4 right-8 text-xs font-medium text-[var(--text-3)] sm:right-12">1 / {total}</p>
        </div>
      </article>

      {outline.slides.map((raw, index) => {
        const slide = resolvePresentationSlideLayout(outline.slides, index);
        return (
          <div key={`${raw.heading}-${index}`}>
            <SlideShell
              productName={productName}
              page={`${index + 2} / ${total}`}
              shapes={slide.shapes}
              regen={
                onRegenerate ? (
                  <button
                    type="button"
                    className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
                    onClick={() => setOpenIndex(openIndex === index ? null : index)}
                    disabled={regeneratingIndex !== null}
                    aria-expanded={openIndex === index}
                    data-testid="presentations-regen"
                  >
                    {regeneratingIndex === index ? t("presentation.regenerating") : t("presentation.regenerate")}
                  </button>
                ) : null
              }
            >
              <SlideBody slide={slide} />
            </SlideShell>
            {slide.notes.trim() ? (
              <p className="mt-2 px-1 text-xs leading-relaxed text-[var(--text-3)]">
                {t("presentation.notes")} <FormattedText text={slide.notes} inline />
              </p>
            ) : null}
            {onOutlineChange ? (
              <div className="mt-3 grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <label className="grid gap-1 text-xs text-[var(--text-2)]">
                  {t("presentation.editHeading")}
                  <input
                    className="text-field"
                    data-testid="presentations-edit-heading"
                    value={slide.heading}
                    onChange={(event) => replaceSlide(index, { ...slide, heading: event.target.value || " " })}
                  />
                </label>
                <label className="grid gap-1 text-xs text-[var(--text-2)]">
                  {t("presentation.editBullets")}
                  <textarea
                    className="text-field min-h-20"
                    data-testid="presentations-edit-bullets"
                    value={slide.bullets.join("\n")}
                    onChange={(event) => replaceSlide(index, { ...slide, bullets: event.target.value.split("\n") })}
                  />
                </label>
                <label className="grid gap-1 text-xs text-[var(--text-2)]">
                  {t("presentation.editNotes")}
                  <textarea
                    className="text-field min-h-16"
                    data-testid="presentations-edit-notes"
                    value={slide.notes}
                    onChange={(event) => replaceSlide(index, { ...slide, notes: event.target.value })}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                    data-testid="presentations-add-rectangle"
                    onClick={() => replaceSlide(index, addShape(slide, "rectangle"))}
                  >
                    {t("presentation.addRectangle")}
                  </button>
                  <button
                    type="button"
                    className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                    data-testid="presentations-add-ellipse"
                    onClick={() => replaceSlide(index, addShape(slide, "ellipse"))}
                  >
                    {t("presentation.addEllipse")}
                  </button>
                  <button
                    type="button"
                    className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                    data-testid="presentations-add-text"
                    onClick={() => replaceSlide(index, addShape(slide, "text"))}
                  >
                    {t("presentation.addText")}
                  </button>
                </div>
                {slide.shapes.map((shape) => (
                  <div key={shape.id} className="flex flex-wrap items-center gap-2">
                    <input
                      className="text-field min-w-40 flex-1"
                      data-testid="presentations-shape-text"
                      aria-label={t("presentation.shapeText")}
                      value={shape.text}
                      onChange={(event) =>
                        replaceSlide(index, {
                          ...slide,
                          shapes: slide.shapes.map((item) =>
                            item.id === shape.id ? { ...item, text: event.target.value.slice(0, 200) } : item,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-3 text-xs"
                      data-testid="presentations-shape-remove"
                      onClick={() =>
                        replaceSlide(index, { ...slide, shapes: slide.shapes.filter((item) => item.id !== shape.id) })
                      }
                    >
                      {t("presentation.removeShape")}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {onRegenerate && openIndex === index ? (
              <JobRegenPanel
                key={index}
                testIdPrefix="presentations"
                models={models}
                defaultModel={defaultModel}
                submitting={regeneratingIndex === index}
                disabled={regeneratingIndex !== null && regeneratingIndex !== index}
                onCancel={() => setOpenIndex(null)}
                onSubmit={(payload) => onRegenerate(index, payload)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
