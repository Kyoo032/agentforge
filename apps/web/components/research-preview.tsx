"use client";

import { FormattedText } from "@/components/formatted-text";
import type { ResearchNotes } from "@/lib/research-notes";
import { safeLinkHref } from "@/lib/safe-link";

type Props = { notes: ResearchNotes };

export function ResearchPreview({ notes }: Props) {
  return (
    <article
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-10"
      data-testid="research-preview"
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">Research</p>
      <h2 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{notes.title}</h2>
      <FormattedText text={notes.summary} className="mt-4 text-sm leading-relaxed text-[var(--text-2)]" />
      <div className="mt-8 space-y-8">
        {notes.notes.map((note, index) => (
          <section key={`${note.heading}-${index}`} data-testid="research-note">
            <h3 className="text-sm font-medium text-[var(--text)]">{note.heading}</h3>
            <FormattedText text={note.body} className="mt-3 text-sm leading-relaxed text-[var(--text-2)]" />
            {note.sources.filter((source) => source.url || source.title).length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--text-3)]">
                {note.sources.map((source) => {
                  const href = source.url ? safeLinkHref(source.url) : null;
                  return (
                    <li key={`${source.url}-${source.title}`}>
                      {href ? (
                        <a href={href} className="underline" target="_blank" rel="noreferrer">
                          {source.title || source.url}
                        </a>
                      ) : (
                        source.title || source.url
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
