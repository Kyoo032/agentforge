"use client";

import { useState, type ReactNode } from "react";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import {
  resolvePresentationSlideLayout,
  type PresentationOutline,
  type PresentationSlide,
} from "@/lib/presentation-outline";
import type { JobStudioModel } from "@/lib/use-job-model";
import { useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";

type Props = {
  outline: PresentationOutline;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
};

function SlideShell({
  children,
  productName,
  page,
  regen,
}: {
  children: ReactNode;
  productName: string;
  page: string;
  regen: ReactNode;
}) {
  return (
    <article
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
      data-testid="presentations-slide"
    >
      <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
      <div className="absolute right-8 top-6 sm:right-12">{regen}</div>
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
}: Props) {
  const { productName } = useProductBrand();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const total = outline.slides.length + 1;

  return (
    <div className="flex flex-col gap-4" data-testid="presentations-preview">
      <article
        className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]"
        data-testid="presentations-slide-title"
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
        <div className="relative flex h-full flex-col justify-center px-8 py-10 sm:px-12">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
            {t("presentation.kicker")}
          </p>
          <h2 className="mt-3 max-w-3xl text-2xl font-medium leading-tight tracking-[var(--track)] text-[var(--text)]">
            {outline.title}
          </h2>
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
