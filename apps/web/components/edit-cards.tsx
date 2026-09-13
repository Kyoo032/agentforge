import { formatUsd } from "@agentforge/core/gateway";
import type { EditJob, OpCard, UnplacedItem } from "@/lib/edit-client";
import { isReviewOpen } from "@/lib/edit-client";
import type { EditProject } from "@agentforge/core/edit";

type Props = {
  cards: OpCard[];
  jobs: EditJob[];
  project: EditProject | null;
  onKeep: (cardId: string) => void;
  onUndo: (cardId: string) => void;
  onTweak: (card: OpCard) => void;
  onCancel: (jobId: string) => void;
  onPlanGo: (card: OpCard) => void;
  onReviewOk: () => void;
};

function jobForCard(jobs: EditJob[], card: OpCard): EditJob | undefined {
  if (card.jobId) {
    return jobs.find((job) => job.id === card.jobId);
  }
  return jobs.find((job) => job.cardId === card.id);
}

function isPlanCard(card: OpCard): boolean {
  return card.toolKey === "propose_plan" || card.status === "plan" || Array.isArray(card.steps);
}

export function EditCards({
  cards,
  jobs,
  project,
  onKeep,
  onUndo,
  onTweak,
  onCancel,
  onPlanGo,
  onReviewOk,
}: Props) {
  const reviewNeeded = project ? !isReviewOpen(project) : false;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      {reviewNeeded ? (
        <article className="rounded-md border border-[var(--line)] bg-[var(--line)]/30 p-3 text-sm" data-testid="edit-review-card">
          <p className="font-medium">Review before export</p>
          <p className="mt-1 text-xs text-[var(--text-2)]">Scrub the full timeline or confirm it looks good.</p>
          <button type="button" className="btn btn-primary mt-2 px-3 py-1 text-xs" data-testid="edit-review-ok" onClick={onReviewOk}>
            Looks good
          </button>
        </article>
      ) : null}
      {cards.map((card) => {
        const job = jobForCard(jobs, card);
        const pendingJob = job && (job.status === "queued" || job.status === "running");
        if (isPlanCard(card)) {
          return (
            <article key={card.id} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" data-testid="edit-plan-card">
              <p className="font-medium">
                {card.verb} {card.object}
              </p>
              {typeof card.estimateUsd === "number" ? (
                <p className="mt-1 text-xs text-[var(--text-2)]">est {formatUsd(card.estimateUsd)}</p>
              ) : (
                <p className="mt-1 text-xs text-[var(--text-2)]">price unknown</p>
              )}
              <button
                type="button"
                className="btn btn-primary mt-2 px-3 py-1 text-xs"
                data-testid="edit-plan-go"
                onClick={() => onPlanGo(card)}
              >
                Go
              </button>
            </article>
          );
        }
        return (
          <article key={card.id} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" data-testid="edit-card">
            <p className="font-medium">
              {card.verb} · {card.object}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-3)]">{card.status}</p>
            {card.thumbs && card.thumbs.length > 0 ? (
              <div className="mt-2 flex gap-1">
                {card.thumbs.slice(0, 6).map((thumb) => (
                  <img key={thumb} src={thumb} alt="" className="h-10 w-10 rounded-sm object-cover" />
                ))}
              </div>
            ) : null}
            {pendingJob ? (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded bg-[var(--line)]" data-testid="edit-card-progress">
                  <div className="h-full bg-accent" style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary mt-2 px-2 py-1 text-xs"
                  data-testid="edit-card-cancel"
                  onClick={() => job.id && onCancel(job.id)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="btn btn-secondary px-2 py-1 text-xs" data-testid="edit-card-keep" onClick={() => onKeep(card.id)}>
                  Keep
                </button>
                <button type="button" className="btn btn-secondary px-2 py-1 text-xs" data-testid="edit-card-undo" onClick={() => onUndo(card.id)}>
                  Undo
                </button>
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs" data-testid="edit-card-tweak" onClick={() => onTweak(card)}>
                  Tweak
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function EditTray({
  items,
  onPlace,
  onDiscard,
}: {
  items: UnplacedItem[];
  onPlace: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-[var(--line)] p-2" data-testid="edit-tray">
      <p className="text-xs font-heading uppercase tracking-[.12em] text-[var(--text-3)]">Unplaced ({items.length})</p>
      <div className="mt-1 flex flex-col gap-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 text-xs" data-testid="edit-tray-item">
            <span className="truncate">{item.prompt ?? item.assetId}</span>
            <span className="flex shrink-0 gap-1">
              <button type="button" className="btn btn-secondary px-2 py-0.5" data-testid="edit-tray-place" onClick={() => onPlace(item.id)}>
                Place
              </button>
              <button type="button" className="btn btn-ghost px-2 py-0.5" data-testid="edit-tray-discard" onClick={() => onDiscard(item.id)}>
                Discard
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
