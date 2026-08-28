"use client";

import type { PresentationOutline } from "@/lib/presentation-outline";

type Props = {
  outline: PresentationOutline;
};

export function PresentationPreview({ outline }: Props) {
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
          <p className="absolute bottom-4 left-8 text-xs font-medium text-ink sm:left-12">Agentforge</p>
        </div>
      </article>

      {outline.slides.map((slide, index) => (
        <article
          key={`${slide.heading}-${index}`}
          className="relative aspect-video w-full overflow-hidden rounded-xl border border-mist bg-paper shadow-sm"
          data-testid="presentations-slide"
        >
          <div className="absolute inset-y-0 left-0 w-1.5 bg-navy" />
          <div className="flex h-full flex-col px-8 py-7 sm:px-12 sm:py-10">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/45">
              Slide {index + 1} of {outline.slides.length}
            </p>
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
      ))}
    </div>
  );
}
