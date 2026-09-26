"use client";

import { useRef, useState, type FormEvent } from "react";
import { ModelSelect } from "@/components/model-select";
import { JOB_REGEN_FILE_ACCEPT, classifyAttachment, type AttachmentKind } from "@/lib/composer-attach";
import type { JobStudioModel } from "@/lib/use-job-model";
import { apiFetch } from "@/lib/api-client";
import { submitOnEnter } from "@/lib/composer-enter";
import { t } from "@/lib/i18n";

export type JobRegenSubmit = {
  instruction: string;
  model: string;
  attachments: Array<{ type: "image_url"; image_url: { url: string; detail: "high" } }>;
};

type HeldFile = {
  id: string;
  file: File;
  kind: Exclude<AttachmentKind, "unsupported" | "video">;
};

type Props = {
  testIdPrefix: "documents" | "presentations" | "finance" | "market";
  models: JobStudioModel[];
  defaultModel: string;
  submitting?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (payload: JobRegenSubmit) => void;
};

async function uploadMedia(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const uploaded = await apiFetch("/api/v1/media", { method: "POST", body: form }).then((response) => response.json());
  if (uploaded.error) {
    throw new Error(uploaded.error.message ?? t("documents.regen.uploadFailed"));
  }
  if (typeof uploaded.url !== "string") {
    throw new Error(t("documents.regen.uploadFailed"));
  }
  return uploaded.url;
}

export function JobRegenPanel({
  testIdPrefix,
  models,
  defaultModel,
  submitting = false,
  disabled = false,
  onCancel,
  onSubmit,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const busy = submitting || uploading || disabled;

  function addFiles(list: FileList | null) {
    if (!list) {
      return;
    }
    const next: HeldFile[] = [];
    for (const file of Array.from(list)) {
      const kind = classifyAttachment(file);
      if (kind === "image" || kind === "text") {
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, file, kind });
        continue;
      }
      setError(t("documents.regen.attachImagesOnly"));
      return;
    }
    setError(null);
    setFiles((current) => [...current, ...next]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      let composed = instruction.trim();
      const attachments: JobRegenSubmit["attachments"] = [];
      for (const held of files) {
        if (held.kind === "text") {
          const body = await held.file.text();
          const block = `\n\n--- ${held.file.name} ---\n${body}`;
          composed = composed ? `${composed}${block}` : body;
          continue;
        }
        attachments.push({
          type: "image_url",
          image_url: { url: await uploadMedia(held.file), detail: "high" },
        });
      }
      onSubmit({ instruction: composed, model, attachments });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("documents.regen.attachFailed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
      onSubmit={(event) => void submit(event)}
      data-testid={`${testIdPrefix}-regen-panel`}
    >
      <textarea
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
        rows={3}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          submitOnEnter(event, () => {
            const form = event.currentTarget.form;
            if (form) {
              form.requestSubmit();
            }
          });
        }}
        placeholder={t("documents.regen.placeholder")}
        disabled={busy}
        data-testid={`${testIdPrefix}-regen-prompt`}
        aria-label={t("documents.regen.aria")}
      />
      <ModelSelect
        models={models}
        value={model}
        onChange={setModel}
        disabled={busy || models.length === 0}
        testId={`${testIdPrefix}-regen-model`}
        className="select-field w-full"
      />
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        accept={JOB_REGEN_FILE_ACCEPT}
        onChange={(event) => addFiles(event.target.files)}
        data-testid={`${testIdPrefix}-regen-file`}
      />
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-1 text-xs text-[var(--text)]"
            >
              <span className="max-w-[12rem] truncate">{item.file.name}</span>
              <button
                type="button"
                className="text-[var(--text-3)] hover:text-[var(--text)]"
                aria-label={t("documents.regen.removeFile", { name: item.file.name })}
                disabled={busy}
                onClick={() => setFiles((current) => current.filter((held) => held.id !== item.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          data-testid={`${testIdPrefix}-regen-attach`}
        >
          {t("documents.regen.attach")}
        </button>
        <button
          type="button"
          className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
          onClick={onCancel}
          disabled={submitting || uploading}
        >
          {t("documents.regen.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn-primary rounded-pill px-4"
          disabled={busy}
          data-testid={`${testIdPrefix}-regen-submit`}
        >
          {submitting || uploading ? (
            <>
              {testIdPrefix === "finance" || testIdPrefix === "market"
                ? t("finance.preview.rewriting")
                : testIdPrefix === "presentations"
                  ? t("presentation.regenerating")
                  : t("documents.regen.busy")}
              <span className="pulse-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </>
          ) : testIdPrefix === "finance" || testIdPrefix === "market" ? (
            t("finance.preview.rewrite")
          ) : testIdPrefix === "presentations" ? (
            t("presentation.regenerate")
          ) : (
            t("documents.regen.submit")
          )}
        </button>
      </div>
    </form>
  );
}
