"use client";

import { useState } from "react";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import type { PresentationOutline } from "@/lib/presentation-outline";
import type { JobStudioModel } from "@/lib/use-job-model";
import { useProductBrand } from "@/lib/product-brand";

type Props = {
  outline: PresentationOutline;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
};

export function PresentationPreview({
  outline,
  models = [],
  defaultModel = "",
  regeneratingIndex = null,
  onRegenerate,
}: Props) {
  const { productName } = useProductBrand();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-4" data-testid="presentations-preview">
      <article
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-navy text-white shadow-sm"
        data-testid="presentations-slide-title"
      >
        <div className="absolute inset-x-0 bottom-0 h-14 bg-mist" />
        <div className="relative flex h-full flex-col justify-center px-8 py-10 sm:px-12">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/70">Presentation</p>
          <h2 className="mt-3 max-w-3xl text-2xl font-semibold leading-tight sm:text-4xl">{outline.title}</h2>
          <p className="absolute bottom-4 left-8 text-xs font-medium text-ink sm:left-12">{productName}</p>
        </div>
      </article>

      {outline.slides.map((slide, index) => (
        <div key={`${slide.heading}-${index}`}>
          <article
            className="relative aspect-video w-full overflow-hidden rounded-xl border border-mist bg-paper shadow-sm"
            data-testid="presentations-slide"
          >
            <div className="absolute inset-y-0 left-0 w-1.5 bg-navy" />
            <div className="flex h-full flex-col px-8 py-7 sm:px-12 sm:py-10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
                  Slide {index + 1} of {outline.slides.length}
                </p>
                {onRegenerate ? (
                  <button
                    type="button"
                    className="rounded-md border border-mist px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
                    onClick={() => setOpenIndex(openIndex === index ? null : index)}
                    disabled={regeneratingIndex !== null}
                    aria-expanded={openIndex === index}
                    data-testid="presentations-regen"
                  >
                    {regeneratingIndex === index ? "Regenerating…" : "Regenerate"}
                  </button>
                ) : null}
              </div>
              <h3 className="mt-2 text-xl font-semibold text-ink sm:text-3xl">{slide.heading}</h3>
              {slide.bullets.length > 0 ? (
                <ul className="mt-5 max-w-3xl list-disc space-y-2 pl-5 text-sm text-ink/85 sm:text-base">
                  {slide.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 text-sm text-ink/50">No bullets on this slide.</p>
              )}
              {slide.notes.trim() ? (
                <p className="mt-auto pt-4 text-xs text-ink/45">Notes: {slide.notes}</p>
              ) : null}
            </div>
          </article>
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
      ))}
    </div>
  );
}
