"use client";

import { useRef, useState, type FormEvent } from "react";
import { ModelSelect } from "@/components/model-select";
import { JOB_REGEN_FILE_ACCEPT, classifyAttachment, type AttachmentKind } from "@/lib/composer-attach";
import type { JobStudioModel } from "@/lib/use-job-model";
import { apiFetch } from "@/lib/api-client";
import { submitOnEnter } from "@/lib/composer-enter";

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
  const uploaded = await apiFetch("/api/v1/media", { method: "POST", body: form }).then((response) =>
    response.json(),
  );
  if (uploaded.error) {
    throw new Error(uploaded.error.message ?? "Upload failed");
  }
  if (typeof uploaded.url !== "string") {
    throw new Error("Upload failed");
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
      setError("Attach images or text files only");
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
      setError(err instanceof Error ? err.message : "Could not attach files");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-mist bg-mist/20 p-3"
      onSubmit={(event) => void submit(event)}
      data-testid={`${testIdPrefix}-regen-panel`}
    >
      <textarea
        className="w-full rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
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
        placeholder="Optional: what should change?"
        disabled={busy}
        data-testid={`${testIdPrefix}-regen-prompt`}
        aria-label="Regenerate instruction"
      />
      <ModelSelect
        models={models}
        value={model}
        onChange={setModel}
        disabled={busy || models.length === 0}
        testId={`${testIdPrefix}-regen-model`}
        className="w-full rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
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
              className="flex items-center gap-2 rounded-md border border-mist bg-paper px-3 py-1 text-xs text-ink"
            >
              <span className="max-w-[12rem] truncate">{item.file.name}</span>
              <button
                type="button"
                className="text-ink/50 hover:text-ink"
                aria-label={`Remove ${item.file.name}`}
                disabled={busy}
                onClick={() => setFiles((current) => current.filter((held) => held.id !== item.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-mist px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          data-testid={`${testIdPrefix}-regen-attach`}
        >
          Attach
        </button>
        <button
          type="button"
          className="rounded-md border border-mist px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
          onClick={onCancel}
          disabled={submitting || uploading}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={busy}
          data-testid={`${testIdPrefix}-regen-submit`}
        >
          {submitting || uploading ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </form>
  );
}
