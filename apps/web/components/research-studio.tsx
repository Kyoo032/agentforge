"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { ArtifactActions } from "@/components/artifact-actions";
import { ArtifactPicker } from "@/components/artifact-picker";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { FormattedText } from "@/components/formatted-text";
import { JobProgressList } from "@/components/job-progress";
import { ModeHeader } from "@/components/mode-header";
import { ModeIcon } from "@/components/mode-icons";
import { ModelSelect } from "@/components/model-select";
import { ResearchPreview } from "@/components/research-preview";
import { t } from "@/lib/i18n";
import { researchNotesToMarkdown, type ResearchNotes } from "@/lib/research-notes";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, studioModelPick } from "@/lib/model-choice";
import { useJobStream } from "@/lib/use-job-stream";

type ResearchResult = ResearchNotes & {
  artifactId: string | null;
  dossierId?: string | null;
  dossier?: { title: string; markdown: string };
};

/** What the studio shows: a fresh run (notes + dossier), or a reopened saved dossier (Markdown only). */
type Shown =
  | { kind: "run"; notes: ResearchNotes; dossierMarkdown: string; artifactId: string | null }
  | { kind: "saved"; title: string; markdown: string; artifactId: string };

type Tab = "notes" | "dossier";

function needsSettingsHint(message: string): boolean {
  return /gateway|api key|settings|runtime_stub|live gateway|tavily|brave/i.test(message);
}

function tabClass(active: boolean): string {
  return active
    ? "select-row wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-3 text-xs font-medium text-[var(--surface)]"
    : "wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]";
}

export function ResearchStudio() {
  const { models, model, pinned: modelPinned, setModel } = useJobModel("research");
  const job = useJobStream<ResearchResult>();
  const [prompt, setPrompt] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [tab, setTab] = useState<Tab>("notes");
  const error = job.error?.message ?? null;

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const topic = prompt.trim();
    if (!topic || job.busy) {
      return;
    }
    // Only a deliberate pick travels as pinned: a seeded default stays rescuable by the host's fallback.
    const result = await job.run("/api/v1/research/stream", {
      prompt: topic,
      ...modelPickBody(studioModelPick(model, modelPinned)),
    });
    if (result) {
      const { artifactId, dossierId, dossier, ...notes } = result;
      setShown({
        kind: "run",
        notes,
        dossierMarkdown: dossier?.markdown ?? researchNotesToMarkdown(notes),
        artifactId: dossierId ?? artifactId,
      });
      setTab("notes");
    }
  }

  const title = shown?.kind === "run" ? shown.notes.title : (shown?.title ?? "");
  const markdown = shown?.kind === "run" ? shown.dossierMarkdown : (shown?.markdown ?? "");

  return (
    <main data-mode="research" className="mx-auto flex min-h-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]" data-testid="research-studio">
      <ModeHeader
        icon="research"
        title={t("research.title")}
        outcome={t("research.expectedInputs")}
        actions={
          <ArtifactPicker
            mode="research"
            label={t("research.reopenSaved")}
            disabled={job.busy}
            testId="research-saved"
            onPick={(artifact) => {
              setShown({ kind: "saved", title: artifact.title, markdown: artifact.body, artifactId: artifact.id });
              setTab("dossier");
            }}
          />
        }
      />

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="research-error"
        >
          {error}
          {needsSettingsHint(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              <Link href="/settings" className="underline">
                {t("research.openSettings")}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <ExampleGallery mode="research" onSelect={(entry) => setPrompt(entry.prompt)} />

      {job.busy || (job.progress.phases.length > 0 && !shown) ? (
        <div className="mt-6">
          <JobProgressList progress={job.progress} busy={job.busy} testId="research-progress" />
        </div>
      ) : null}

      <div className="mt-8 flex-1">
        {shown ? (
          <div className="enter-rise space-y-4">
            <ArtifactActions
              title={title}
              markdown={markdown}
              artifactId={shown.artifactId}
              kbType="Dossier"
              disabled={job.busy}
              testIdPrefix="research"
            />
            {shown.kind === "run" ? (
              <div className="flex gap-2" role="tablist" data-testid="research-tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "notes"}
                  className={tabClass(tab === "notes")}
                  onClick={() => setTab("notes")}
                  data-testid="research-tab-notes"
                >
                  {t("research.tabNotes")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "dossier"}
                  className={tabClass(tab === "dossier")}
                  onClick={() => setTab("dossier")}
                  data-testid="research-tab-dossier"
                >
                  {t("research.tabDossier")}
                </button>
              </div>
            ) : null}
            {shown.kind === "run" && tab === "notes" ? (
              <ResearchPreview notes={shown.notes} />
            ) : (
              <article
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-10"
                data-testid="research-dossier-preview"
              >
                <FormattedText text={markdown} className="text-sm leading-relaxed text-[var(--text-2)]" />
              </article>
            )}
          </div>
        ) : job.busy ? null : (
          <div
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center"
            data-testid="research-studio-empty"
          >
            <span className="icon-orb icon-orb-lg icon-float mx-auto">
              <ModeIcon name="research" size={24} strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-sm font-medium text-[var(--text)]">{t("research.emptyTitle")}</p>
            <p className="mt-2 text-sm text-[var(--text-2)]">{t("research.emptyBody")}</p>
          </div>
        )}
      </div>

      <form
        className="raise sticky bottom-4 mt-8 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="research-studio-prompt-bar"
      >
        <ModelSelect
          models={models}
          value={model}
          onChange={setModel}
          disabled={job.busy || models.length === 0}
          testId="research-studio-model"
          className="h-8 w-full rounded-lg border border-[var(--line)] bg-transparent px-2 text-xs text-[var(--text-2)] wash"
        />
        <div className="flex gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="research"
            model={model}
            disabled={job.busy}
            testId="research-enhance"
            onApply={setPrompt}
          />
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("research.promptPlaceholder")}
            disabled={job.busy}
            data-testid="research-prompt"
            aria-label={t("research.promptAria")}
          />
          {job.busy ? (
            <button
              type="button"
              className="wash inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
              onClick={job.cancel}
              data-testid="research-cancel"
            >
              {t("research.cancel")}
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary h-8 shrink-0 rounded-pill px-4"
            disabled={job.busy || !prompt.trim()}
            data-testid="research-generate"
          >
            {job.busy ? (
              <>
                {t("research.working")}
                <span className="pulse-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </>
            ) : (
              t("research.generate")
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
