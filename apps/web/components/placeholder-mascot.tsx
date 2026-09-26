import { t } from "@/lib/i18n";

/**
 * PLACEHOLDER mascot.
 *
 * The owner is designing the Nultron character himself. This file is the only
 * art: a geometric face in the desk's own accent, not a brand mark. To swap in
 * the real mascot, replace the `<svg>` and keep `PlaceholderMascot`,
 * `data-testid="chat-mascot"`, `data-placeholder="nultron-mascot"`, and
 * `data-state` (`idle` | `thinking` | `answering` | `error`). Motion lives in
 * `app/globals.css` under `.chat-mascot`.
 */
export type PlaceholderMascotState = "idle" | "thinking" | "answering" | "error";

const LABEL: Record<PlaceholderMascotState, string> = {
  idle: "chat.mascot.idle",
  thinking: "chat.mascot.thinking",
  answering: "chat.mascot.answering",
  error: "chat.mascot.error",
};

export function PlaceholderMascot({ state }: { state: PlaceholderMascotState }) {
  return (
    <span
      className="chat-mascot"
      data-testid="chat-mascot"
      data-placeholder="nultron-mascot"
      data-state={state}
      role="img"
      aria-label={t(LABEL[state])}
    >
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect
          x="3.5"
          y="3.5"
          width="25"
          height="25"
          rx="4"
          fill="var(--accent-soft)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle className="chat-mascot-eyes" cx="12" cy="14" r="1.5" fill="currentColor" />
        <circle className="chat-mascot-eyes" cx="20" cy="14" r="1.5" fill="currentColor" />
        <path className="chat-mascot-mouth chat-mascot-mouth-idle" d="M11 20.5h10" />
        <path className="chat-mascot-mouth chat-mascot-mouth-think" d="M12 20c1.6 1.8 6.4 1.8 8 0" />
        <path className="chat-mascot-mouth chat-mascot-mouth-answer" d="M11 19.5c1.4 2.4 8.6 2.4 10 0" />
        <path className="chat-mascot-mouth chat-mascot-mouth-error" d="M11 22c1.6-2 8.4-2 10 0" />
      </svg>
    </span>
  );
}
