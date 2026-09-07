import { formatUsd } from "@agentforge/core/gateway";
import type { EditJob, OpCard, UnplacedItem } from "@/lib/edit-client";
import { turnSpendUsd } from "@/lib/edit-client";
import type { EditProject } from "@agentforge/core/edit";
import { EditCards, EditTray } from "@/components/edit-cards";
import { useState, type FormEvent } from "react";

type Props = {
  project: EditProject | null;
  cards: OpCard[];
  jobs: EditJob[];
  unplaced: UnplacedItem[];
  spendCap: number;
  emitLockActive: boolean;
  composerPrefill: string;
  onComposerPrefill: (text: string) => void;
  onSend: (text: string) => void;
  onKeep: (cardId: string) => void;
  onUndo: (cardId: string) => void;
  onTweak: (card: OpCard) => void;
  onCancel: (jobId: string) => void;
  onPlanGo: (card: OpCard) => void;
  onReviewOk: () => void;
  onPlace: (id: string) => void;
  onDiscard: (id: string) => void;
};

export function EditAgentPanel({
  project,
  cards,
  jobs,
  unplaced,
  spendCap,
  emitLockActive,
  composerPrefill,
  onComposerPrefill,
  onSend,
  onKeep,
  onUndo,
  onTweak,
  onCancel,
  onPlanGo,
  onReviewOk,
  onPlace,
  onDiscard,
}: Props) {
  const [text, setText] = useState("");
  const spent = turnSpendUsd(cards, jobs);
  const value = composerPrefill || text;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      return;
    }
    onSend(next);
    setText("");
    onComposerPrefill("");
  }

  return (
    <aside className="flex h-full min-h-0 w-[240px] min-w-[200px] max-w-[280px] shrink flex-col overflow-hidden border-l border-divider bg-paper" data-testid="edit-agent-panel">
      <div className="flex items-center justify-between border-b border-divider px-3 py-2">
        <span className="text-xs font-heading uppercase tracking-[.12em] text-ink/50">Agent</span>
        <span className="text-xs text-ink/60" data-testid="edit-spend-meter">
          turn {formatUsd(spent)} / {formatUsd(spendCap)}
        </span>
      </div>
      {emitLockActive ? (
        <p className="border-b border-divider px-3 py-1 text-[11px] text-accent" data-testid="edit-emit-lock">
          Agent writing…
        </p>
      ) : null}
      <EditCards
        cards={cards}
        jobs={jobs}
        project={project}
        onKeep={onKeep}
        onUndo={onUndo}
        onTweak={onTweak}
        onCancel={onCancel}
        onPlanGo={onPlanGo}
        onReviewOk={onReviewOk}
      />
      <EditTray items={unplaced} onPlace={onPlace} onDiscard={onDiscard} />
      <form className="border-t border-divider p-2" onSubmit={onSubmit}>
        <textarea
          className="h-20 w-full resize-none rounded-md border border-mist bg-transparent px-2 py-1.5 text-sm outline-none"
          placeholder="Ask the editor…"
          value={value}
          onChange={(event) => {
            onComposerPrefill("");
            setText(event.target.value);
          }}
          data-testid="edit-composer"
        />
        <button type="submit" className="btn btn-primary mt-1 w-full py-1.5 text-sm" data-testid="edit-composer-send">
          Send
        </button>
      </form>
    </aside>
  );
}
