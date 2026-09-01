"use client";

import type { DocumentDraft } from "@/lib/document-outline";

type Props = {
  draft: DocumentDraft;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number) => void;
};

export function DocumentPreview({ draft, regeneratingIndex = null, onRegenerate }: Props) {
  return (
    <article className="rounded-xl border border-mist bg-paper px-8 py-10 shadow-sm" data-testid="documents-preview">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">Document</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{draft.title}</h2>
      <div className="mt-8 space-y-8">
        {draft.sections.map((section, index) => (
          <section key={`${section.heading}-${index}`} data-testid="documents-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-navy">{section.heading}</h3>
              {onRegenerate ? (
                <button
                  type="button"
                  className="rounded-md border border-mist px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
                  onClick={() => onRegenerate(index)}
                  disabled={regeneratingIndex !== null}
                  data-testid="documents-regen"
                >
                  {regeneratingIndex === index ? "Regenerating…" : "Regenerate"}
                </button>
              ) : null}
            </div>
            {section.body.split(/\n{2,}/).map((para) => (
              <p key={para.slice(0, 24)} className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
