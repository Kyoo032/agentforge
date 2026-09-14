"use client";

import { useRef, type DragEvent } from "react";
import type { MatterDocCard } from "@agentforge/core/legal";
import { LEGAL_ACCEPT } from "@/lib/legal-client";
import { roleLabel, type PendingUpload } from "@/lib/legal-view";
import { DIM } from "@/components/legal-parts";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  docs: readonly MatterDocCard[];
  pending: readonly PendingUpload[];
  locked: boolean;
  onFiles: (files: File[]) => void;
  onCycleRole: (docId: string) => void;
  onRemove: (docId: string) => void;
};

const ACCENT_ROLES = new Set(["counterparty-draft", "our-draft", "executed"]);

/** Drop zone plus the per-document list with clickable role tags. */
export function LegalFileList({ docs, pending, locked, onFiles, onCycleRole, onRemove }: Props) {
  const input = useRef<HTMLInputElement | null>(null);

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (locked) {
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      onFiles(files);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        accept={LEGAL_ACCEPT}
        className="hidden"
        disabled={locked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) {
            onFiles(files);
          }
        }}
        data-testid="legal-file-input"
      />
      <button
        type="button"
        className="mt-2 w-full rounded border border-dashed border-divider px-4 py-5 text-center text-sm hover:border-accent disabled:opacity-50"
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        disabled={locked}
        data-testid="legal-drop-zone"
      >
        {t("legal.files.drop")}
        <br />
        <span className={`text-xs ${DIM}`}>
          {t("legal.files.docxOnly", {
            count: docs.length,
            filesWord: t(docs.length === 1 ? "legal.files.file" : "legal.files.files"),
          })}
        </span>
      </button>
      <ul className="mt-2 divide-y divide-divider text-[13px]" data-testid="legal-file-list">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-center gap-2 py-1.5" data-testid="legal-file-row">
            <span className="tag tag-neutral font-mono text-xs">{doc.id}</span>
            <span className="min-w-0 flex-1 truncate" title={doc.name}>
              {doc.name}
            </span>
            <button
              type="button"
              className={`tag ${ACCENT_ROLES.has(doc.role) ? "tag-accent" : "tag-neutral"}`}
              onClick={() => onCycleRole(doc.id)}
              disabled={locked}
              title={t("legal.files.changeRole")}
              data-testid={`legal-file-role-${doc.id}`}
            >
              {labeled(`legal.role.${doc.role}`, roleLabel(doc.role))}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-xs"
              onClick={() => onRemove(doc.id)}
              disabled={locked}
              aria-label={t("legal.files.removeAria", { name: doc.name })}
              data-testid={`legal-file-remove-${doc.id}`}
            >
              ×
            </button>
          </li>
        ))}
        {pending.map((item, index) => (
          <li key={`${item.name}-${index}`} className={`flex items-center gap-2 py-1.5 ${DIM}`}>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="tag tag-neutral">{t(`legal.files.${item.status}`)}</span>
          </li>
        ))}
      </ul>
      {docs.length > 0 ? (
        <p className={`mt-1 text-xs ${DIM}`}>{t("legal.files.rolesHint")}</p>
      ) : null}
    </div>
  );
}
