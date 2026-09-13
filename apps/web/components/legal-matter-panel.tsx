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
    <LegalPanel label="Matter" testId="legal-matter-panel">
      <input
        value={draft.title}
        onChange={(event) => onDraft({ ...draft, title: event.target.value })}
        className="input mt-2"
        placeholder="Matter title, e.g. Meridian credit agreement, turn 3"
        disabled={locked}
        aria-label="Matter title"
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

      <div className="panel-label mt-4">We act for</div>
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
              {role === "other" ? "Other…" : role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>
        <input
          value={draft.side.party}
          onChange={(event) => onDraft({ ...draft, side: { ...draft.side, party: event.target.value } })}
          className="input min-w-0 flex-1 px-2 py-1 text-[13px]"
          placeholder="Client name as it should appear"
          disabled={locked}
          aria-label="Client name"
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
            placeholder="Position, e.g. buyer"
            disabled={locked}
            aria-label="Position"
            data-testid="legal-side-role-other"
          />
        ) : null}
        <input
          value={draft.side.counterparty}
          onChange={(event) => onDraft({ ...draft, side: { ...draft.side, counterparty: event.target.value } })}
          className="input px-2 py-1 text-[13px]"
          placeholder="Counterparty label, e.g. the Lenders"
          disabled={locked}
          aria-label="Counterparty"
          data-testid="legal-side-counterparty"
        />
      </div>

      <div className="panel-label mt-4">Work</div>
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
            {WORK_TYPE_LABEL[workType]}
          </button>
        ))}
      </div>

      <div className="panel-label mt-4">Deliverables</div>
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
            {option.label}
            <span className="tag tag-neutral font-mono text-[12px]">{option.format}</span>
            {option.available ? null : <span className="text-[12px]">not available in this version</span>}
          </label>
        ))}
      </div>

      <div className="panel-label mt-4">Playbook and checklist</div>
      <select
        className="input mt-1.5"
        value={draft.playbookId ?? ""}
        onChange={(event) => onDraft({ ...draft, playbookId: event.target.value || null })}
        disabled={locked}
        aria-label="Playbook"
        data-testid="legal-playbook"
      >
        <option value="">No playbook · generic review</option>
        {playbooks.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <p className={`mt-1 text-[12px] ${DIM}`}>
        {playbook
          ? `${playbook.contractType || "Contract"} · checklist of ${playbook.itemCount} items`
          : "Built-in playbooks, plus Knowledge Base sources of type Playbook."}
      </p>

      <div className="panel-label mt-4">Memorandum header</div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <input
          value={draft.author}
          onChange={(event) => onDraft({ ...draft, author: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder="From"
          disabled={locked}
          aria-label="Author"
          data-testid="legal-author"
        />
        <input
          value={draft.addressee}
          onChange={(event) => onDraft({ ...draft, addressee: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder="To"
          disabled={locked}
          aria-label="Addressee"
          data-testid="legal-addressee"
        />
        <input
          value={draft.firm}
          onChange={(event) => onDraft({ ...draft, firm: event.target.value })}
          className="input px-2 py-1 text-[13px]"
          placeholder="Firm"
          disabled={locked}
          aria-label="Firm"
          data-testid="legal-firm"
        />
      </div>

      <div className="panel-label mt-4">Instructions</div>
      <textarea
        rows={4}
        value={draft.instructions}
        onChange={(event) => onDraft({ ...draft, instructions: event.target.value })}
        maxLength={LEGAL_CAPS.maxInstructionChars}
        className="input mt-1.5 text-[13px]"
        placeholder="What to compare against, which points to flag, and which points to reserve for the partner."
        disabled={locked}
        aria-label="Instructions"
        data-testid="legal-instructions"
      />
    </LegalPanel>
  );
}
