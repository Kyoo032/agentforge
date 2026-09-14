"use client";

import type { DeliverableKind, MatterDocCard } from "@agentforge/core/legal";
import { LEGAL_CAPS, LEGAL_WORK_TYPES } from "@agentforge/core/legal";
import type { LegalPlaybookSummary } from "@/lib/legal-client";
import {
  DELIVERABLE_OPTIONS,
  SIDE_ROLE_OPTIONS,
  WORK_TYPE_LABEL,
  type LegalDraft,
  type PendingUpload,
} from "@/lib/legal-view";
import { LegalFileList } from "@/components/legal-file-list";
import { DIM, LegalPanel } from "@/components/legal-parts";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  draft: LegalDraft;
  onDraft: (next: LegalDraft) => void;
  docs: readonly MatterDocCard[];
  pending: readonly PendingUpload[];
  playbooks: readonly LegalPlaybookSummary[];
  locked: boolean;
  onFiles: (files: File[]) => void;
  onCycleRole: (docId: string) => void;
  onRemoveFile: (docId: string) => void;
};

function toggleDeliverable(list: readonly DeliverableKind[], kind: DeliverableKind): DeliverableKind[] {
  return list.includes(kind) ? list.filter((item) => item !== kind) : [...list, kind];
}

/** Screen 1, left column: the matter form. */
export function LegalMatterPanel({
  draft,
  onDraft,
  docs,
  pending,
  playbooks,
  locked,
  onFiles,
  onCycleRole,
  onRemoveFile,
}: Props) {
  const playbook = playbooks.find((item) => item.id === draft.playbookId) ?? null;
  const isOtherSide = draft.side.role !== "borrower" && draft.side.role !== "lender";

  return (
    <LegalPanel label={t("legal.matter.panel")} testId="legal-matter-panel">
      <input
        value={draft.title}
        onChange={(event) => onDraft({ ...draft, title: event.target.value })}
        className="input mt-2"
        placeholder={t("legal.matter.titlePlaceholder")}
        disabled={locked}
        aria-label={t("legal.matter.titleAria")}
        data-testid="legal-matter-title"
      />
      <LegalFileList
        docs={docs}
        pending={pending}
        locked={locked}
        onFiles={onFiles}
        onCycleRole={onCycleRole}
        onRemove={onRemoveFile}
      />

      <div className="panel-label mt-4">{t("legal.matter.weActFor")}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="seg" data-testid="legal-side">
          {SIDE_ROLE_OPTIONS.map((role) => (
            <button
              key={role}
              type="button"
              className="seg-opt"
              aria-pressed={role === "other" ? isOtherSide : draft.side.role === role}
              onClick={() => onDraft({ ...draft, side: { ...draft.side, role } })}
              disabled={locked}
              data-testid={`legal-side-${role}`}
            >
              {role === "other"
                ? t("legal.matter.other")
                : labeled(`legal.side.${role}`, role.charAt(0).toUpperCase() + role.slice(1))}
            </button>
          ))}
        </div>
        <input
          value={draft.side.party}
          onChange={(event) => onDraft({ ...draft, side: { ...draft.side, party: event.target.value } })}
          className="input min-w-0 flex-1 px-2 py-1 text-[13px]"
          placeholder={t("legal.matter.clientPlaceholder")}
          disabled={locked}
          aria-label={t("legal.matter.clientAria")}
          data-testid="legal-side-party"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {isOtherSide ? (
          <input
            value={draft.side.role === "other" ? "" : draft.side.role}
            onChange={(event) =>
              onDraft({ ...draft, side: { ...draft.side, role: event.target.value.trim() || "other" } })
            }
            className="input px-2 py-1 text-[13px]"
            placeholder={t("legal.matter.positionPlaceholder")}
            disabled={locked}
            aria-label={t("legal.matter.positionAria")}
            data-testid="legal-side-role-other"
          />
        ) : null}
        <input
          value={draft.side.counterparty}
          onChange={(event) => onDraft({ ...draft, side: { ...draft.side, counterparty: event.target.value } })}
          className="input px-2 py-1 text-[13px]"
          placeholder={t("legal.matter.counterpartyPlaceholder")}
          disabled={locked}
          aria-label={t("legal.matter.counterpartyAria")}
          data-testid="legal-side-counterparty"
        />
      </div>

      <div className="panel-label mt-4">{t("legal.matter.work")}</div>
      <div className="seg mt-1.5" data-testid="legal-work-type">
        {LEGAL_WORK_TYPES.map((workType) => (
          <button
            key={workType}
            type="button"
            className="seg-opt"
            aria-pressed={draft.workType === workType}
            onClick={() => onDraft({ ...draft, workType })}
            disabled={locked}
            data-testid={`legal-work-type-${workType}`}
          >
            {labeled(`legal.workType.${workType}`, WORK_TYPE_LABEL[workType])}
          </button>
        ))}
      </div>

      <div className="panel-label mt-4">{t("legal.matter.deliverables")}</div>
      <div className="mt-1 space-y-1">
        {DELIVERABLE_OPTIONS.map((option) => (
          <label key={option.kind} className={`flex items-center gap-2 text-[13px] ${option.available ? "" : DIM}`}>
            <input
              type="checkbox"
              checked={draft.deliverables.includes(option.kind)}
              onChange={() => onDraft({ ...draft, deliverables: toggleDeliverable(draft.deliverables, option.kind) })}
              disabled={locked || !option.available}
              data-testid={`legal-deliverable-${option.kind}`}
            />
            {labeled(`legal.deliverable.${option.kind}`, option.label)}
            <span className="tag tag-neutral font-mono text-xs">{option.format}</span>
            {option.available ? null : <span className="text-xs">{t("legal.matter.unavailable")}</span>}
          </label>
        ))}
      </div>

      <div className="panel-label mt-4">{t("legal.matter.playbookHeading")}</div>
      <select
        className="input mt-1.5"
        value={draft.playbookId ?? ""}
        onChange={(event) => onDraft({ ...draft, playbookId: event.target.value || null })}
        disabled={locked}
        aria-label={t("legal.matter.playbookAria")}
        data-testid="legal-playbook"
      >
        <option value="">{t("legal.matter.noPlaybook")}</option>
        {playbooks.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <p className={`mt-1 text-xs ${DIM}`}>
        {playbook
          ? t("legal.matter.playbookMeta", {
              type: playbook.contractType || t("legal.matter.contractFallback"),
              count: playbook.itemCount,
            })
          : t("legal.matter.playbookHint")}
      </p>

      <div className="panel-label mt-4">{t("legal.matter.memoHeader")}</div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <input
          value={draft.author}
          onChange={(event) => onDraft({ ...draft, author: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder={t("legal.matter.fromPlaceholder")}
          disabled={locked}
          aria-label={t("legal.matter.fromAria")}
          data-testid="legal-author"
        />
        <input
          value={draft.addressee}
          onChange={(event) => onDraft({ ...draft, addressee: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder={t("legal.matter.toPlaceholder")}
          disabled={locked}
          aria-label={t("legal.matter.toAria")}
          data-testid="legal-addressee"
        />
        <input
          value={draft.firm}
          onChange={(event) => onDraft({ ...draft, firm: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder={t("legal.matter.firmPlaceholder")}
          disabled={locked}
          aria-label={t("legal.matter.firmAria")}
          data-testid="legal-firm"
        />
      </div>

      <div className="panel-label mt-4">{t("legal.matter.instructions")}</div>
      <textarea
        rows={4}
        value={draft.instructions}
        onChange={(event) => onDraft({ ...draft, instructions: event.target.value })}
        maxLength={LEGAL_CAPS.maxInstructionChars}
        className="input mt-1.5 text-[13px]"
        placeholder={t("legal.matter.instructionsPlaceholder")}
        disabled={locked}
        aria-label={t("legal.matter.instructionsAria")}
        data-testid="legal-instructions"
      />
    </LegalPanel>
  );
}
