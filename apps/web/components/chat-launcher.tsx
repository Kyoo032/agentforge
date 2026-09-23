"use client";

import { ChatKeyStatus } from "@/components/chat-key-status";
import { t } from "@/lib/i18n";

/**
 * The empty Chat surface.
 *
 * History, so the shape here is not re-litigated: a three-step checklist, three mode
 * cards and a four-tile model strip were cut on 2026-09-23 because they offered the
 * same choice twice and recommended modes the rail already lists as first-class
 * entries (owner: "we already have the modes on the navbar so why suggest them again?").
 * Four terse chips went in their place.
 *
 * Those chips were too thin (owner: "still very plain … we need to encourage them to
 * prompt by helping them get ideas"). So each idea is now a card that says what it is
 * FOR in one line — title, hint, and a prompt that lands in the composer. They are
 * shaped by *intent*, not by mode, which is what keeps them from duplicating the rail:
 * "shape a plan" is not a mode, it is a thing you might want.
 *
 * Clicking fills the composer rather than sending, so the prompt is a starting point
 * the user edits, not a message fired off on their behalf.
 */
const IDEAS = ["plan", "summarise", "rewrite", "decide"] as const;

/** One glyph per intent. Decorative — the label carries the meaning. */
function IdeaIcon({ id }: { id: (typeof IDEAS)[number] }) {
  const shared = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "plan") {
    return (
      <svg {...shared}>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6l1.5 1.5L8 5" />
        <path d="M4 16l1.5 1.5L8 15" />
        <circle cx="5.5" cy="12" r="1" />
      </svg>
    );
  }
  if (id === "summarise") {
    return (
      <svg {...shared}>
        <path d="M4 7h16M4 12h10M4 17h13" />
        <path d="M17 12l2.5 2.5L22 12" />
      </svg>
    );
  }
  if (id === "rewrite") {
    return (
      <svg {...shared}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="M12 3v18" />
      <path d="M5 7h14M5 17h14" />
      <path d="M8 7l-3 5h6zM16 17l3-5h-6z" />
    </svg>
  );
}

export function ChatLauncher({ onSuggest }: { onSuggest?: (text: string) => void }) {
  return (
    /* `min-h-full` + `justify-center`: the ideas sit in the middle of the desk rather
       than stranded at the top of a mostly-empty box. It still scrolls on a short
       window, because the min-height is a floor, not a fixed height. */
    <div
      className="mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col justify-center py-10"
      data-testid="chat-empty"
    >
      <div className="flex flex-col items-center text-center">
        <h2 className="font-heading text-[var(--fs-24)] font-semibold leading-[var(--lh-tight)] tracking-[var(--track)] text-[var(--text)]">
          {t("chat.empty.headline")}
        </h2>
        <ChatKeyStatus />
      </div>

      <p className="mt-10 text-center text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-3)]">
        {t("chat.empty.ideas.title")}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="chat-suggestions">
        {IDEAS.map((id) => (
          <button
            key={id}
            type="button"
            className="wash group flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-left hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
            onClick={() => onSuggest?.(t(`chat.empty.ideas.${id}.prompt`))}
            data-testid="chat-suggestion"
            data-idea={id}
          >
            <span className="mt-0.5 shrink-0 text-[var(--accent)]">
              <IdeaIcon id={id} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--text)]">
                {t(`chat.empty.ideas.${id}.label`)}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--text-3)]">
                {t(`chat.empty.ideas.${id}.hint`)}
              </span>
            </span>
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-[var(--text-2)]">{t("chat.empty.pickModel")}</p>
    </div>
  );
}