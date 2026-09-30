import type { CSSProperties, Ref } from "react";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import type { GuidePlacement } from "@/lib/guide-placement";
import { t } from "@/lib/i18n";

/**
 * One card of the first-run guide: the welcome offer, or a step. Presentational only. It draws what
 * it is given and calls back; where it goes (`guide-placement.ts`), what it says (`guide-steps.ts`)
 * and what the keys do (`guide-keys.ts`) are decided elsewhere, which is what lets a node test render
 * it and read the markup.
 *
 * Every card has the same controls, because the person must always be able to leave:
 * a visible Skip, a close button (also Escape), and Next. Back is on every step but the first and is
 * absent, not disabled, on the offer and on step one.
 *
 * Accessibility: `role="dialog"` with a label (`aria-label`, the tour's name) and a description made
 * of the progress, the title and the body, so a screen reader reads the step when focus lands on the
 * card. `aria-modal` because the app behind it is inert while it is open. The visible words are the
 * accessible names of the buttons; the mascot is decorative, the text beside it says everything.
 */
export type GuideCardProps = {
  readonly mode: "offer" | "step";
  /** Zero based. Ignored on the offer. */
  readonly index: number;
  readonly total: number;
  readonly stepId: string | null;
  readonly title: string;
  readonly body: string;
  readonly productName: string;
  readonly placement: GuidePlacement;
  readonly style: CSSProperties;
  readonly cardRef?: Ref<HTMLDivElement>;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onSkip: () => void;
  readonly onClose: () => void;
};

export const GUIDE_TITLE_ID = "guide-title";
export const GUIDE_BODY_ID = "guide-body";
export const GUIDE_PROGRESS_ID = "guide-progress";

const buttonTouch = "min-h-[40px]";

function Dots({ index, total }: { index: number; total: number }) {
  const positions = Array.from({ length: total }, (_, position) => position);
  return (
    <ol className="mt-4 flex items-center gap-1.5" aria-hidden="true" data-testid="guide-dots">
      {positions.map((position) => (
        <li
          key={position}
          data-current={position === index ? "true" : undefined}
          className={`h-1.5 rounded-pill transition-[width,background-color] ${
            position === index ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-[var(--line)]"
          }`}
        />
      ))}
    </ol>
  );
}

export function GuideCard({
  mode,
  index,
  total,
  stepId,
  title,
  body,
  productName,
  placement,
  style,
  cardRef,
  onNext,
  onBack,
  onSkip,
  onClose,
}: GuideCardProps) {
  const offer = mode === "offer";
  const last = !offer && index >= total - 1;
  const progress = offer ? "" : t("guide.progress", { current: index + 1, total });
  const nextLabel = offer ? t("guide.offer.start") : last ? t("guide.done") : t("guide.next");

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("guide.dialogLabel", { productName })}
      aria-describedby={offer ? `${GUIDE_TITLE_ID} ${GUIDE_BODY_ID}` : `${GUIDE_PROGRESS_ID} ${GUIDE_TITLE_ID} ${GUIDE_BODY_ID}`}
      tabIndex={-1}
      data-testid="guide-card"
      data-guide-mode={mode}
      data-guide-step={stepId ?? undefined}
      data-guide-index={offer ? undefined : index}
      data-guide-placement={placement}
      className="enter-fade fixed z-[100] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[var(--text)] shadow-float focus:outline-none"
      style={style}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <NultronMascot state={offer ? "wave" : "presenting"} placement="beside" size={36} mode="chat" decorative />
        </span>
        <div className="min-w-0 flex-1">
          {offer ? null : (
            <p id={GUIDE_PROGRESS_ID} className="text-xs text-[var(--text-3)]" data-testid="guide-progress">
              {progress}
            </p>
          )}
          <h2
            id={GUIDE_TITLE_ID}
            className="font-heading text-lg font-semibold leading-[var(--lh-tight)] tracking-[var(--track)]"
            data-testid="guide-title"
          >
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon -mr-1 -mt-1 h-10 w-10 shrink-0 text-[var(--text-2)]"
          onClick={onClose}
          aria-label={t("guide.close")}
          title={t("guide.close")}
          data-testid="guide-close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p id={GUIDE_BODY_ID} className="mt-2 text-sm text-[var(--text-2)]" data-testid="guide-body">
        {body}
      </p>
      {offer ? null : <Dots index={index} total={total} />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <button
          type="button"
          className={`${buttonTouch} rounded-md px-1 text-sm text-[var(--text-2)] underline underline-offset-2 hover:text-[var(--text)]`}
          onClick={onSkip}
          data-testid="guide-skip"
        >
          {t("guide.skip")}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {offer || index === 0 ? null : (
            <button type="button" className={`btn ${buttonTouch}`} onClick={onBack} data-testid="guide-back">
              {t("guide.back")}
            </button>
          )}
          <button type="button" className={`btn btn-primary ${buttonTouch}`} onClick={onNext} data-testid="guide-next">
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
