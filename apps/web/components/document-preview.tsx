"use client";

import { useState } from "react";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import { t } from "@/lib/i18n";
import type { DocumentDraft } from "@/lib/document-outline";
import type { JobStudioModel } from "@/lib/use-job-model";

type Props = {
  draft: DocumentDraft;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
};

export function DocumentPreview({
  draft,
  models = [],
  defaultModel = "",
  regeneratingIndex = null,
  onRegenerate,
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <article
      className="enter-rise rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-10"
      data-testid="documents-preview"
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
        {t("documents.previewKicker")}
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{draft.title}</h2>
      <div className="mt-8 space-y-8">
        {draft.sections.map((section, index) => (
          <section key={`${section.heading}-${index}`} data-testid="documents-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-medium text-[var(--text)]">{section.heading}</h3>
              {onRegenerate ? (
                <button
                  type="button"
                  className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  disabled={regeneratingIndex !== null}
                  aria-expanded={openIndex === index}
                  data-testid="documents-regen"
                >
                  {regeneratingIndex === index ? t("documents.regen.busy") : t("documents.regen.action")}
                </button>
              ) : null}
            </div>
            <FormattedText text={section.body} className="mt-3 text-sm leading-relaxed text-[var(--text-2)]" />
            {onRegenerate && openIndex === index ? (
              <JobRegenPanel
                key={index}
                testIdPrefix="documents"
                models={models}
                defaultModel={defaultModel}
                submitting={regeneratingIndex === index}
                disabled={regeneratingIndex !== null && regeneratingIndex !== index}
                onCancel={() => setOpenIndex(null)}
                onSubmit={(payload) => onRegenerate(index, payload)}
              />
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
