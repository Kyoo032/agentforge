"use client";

import { FormattedText } from "@/components/formatted-text";
import type { ResearchNotes } from "@/lib/research-notes";

type Props = { notes: ResearchNotes };

export function ResearchPreview({ notes }: Props) {
  return (
    <article className="rounded-xl border border-mist bg-paper px-8 py-10 shadow-sm" data-testid="research-preview">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">Research</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{notes.title}</h2>
      <FormattedText text={notes.summary} className="mt-4 text-sm leading-relaxed text-ink/80" />
      <div className="mt-8 space-y-8">
        {notes.notes.map((note, index) => (
          <section key={`${note.heading}-${index}`} data-testid="research-note">
            <h3 className="text-lg font-semibold text-navy">{note.heading}</h3>
            <FormattedText text={note.body} className="mt-3 text-sm leading-relaxed text-ink/85" />
            {note.sources.filter((source) => source.url || source.title).length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink/60">
                {note.sources.map((source) => (
                  <li key={`${source.url}-${source.title}`}>
                    {source.url ? (
                      <a href={source.url} className="underline" target="_blank" rel="noreferrer">
                        {source.title || source.url}
                      </a>
                    ) : (
                      source.title
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
