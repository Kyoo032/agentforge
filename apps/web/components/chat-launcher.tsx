"use client";

import type { CSSProperties } from "react";
import { ChatKeyStatus } from "@/components/chat-key-status";
import { FloatingShapes } from "@/components/floating-shapes";
import { ModeIcon } from "@/components/mode-icons";
import { t } from "@/lib/i18n";
import { useDeskNeedsKey } from "@/lib/use-desk-needs-key";

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

/** A colour per intent, borrowed from the mode palette so the cards read as distinct. */
const IDEA_MODE: Record<(typeof IDEAS)[number], string> = {
  plan: "research",
  summarise: "documents",
  rewrite: "edit",
  decide: "finance",
};

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
  const needsKey = useDeskNeedsKey();
  return (
    /* `min-h-full` + safe center: short desks sit in the middle. A short window
       (900px) must not push the hero above the pane — `safe center` falls back
       to the start when the block is taller than the scroller. */
    <div
      className="chat-empty-fit mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col py-6"
      data-testid="chat-empty"
      data-needs-key={needsKey ? "true" : "false"}
    >
      <div className="hero-aurora enter-rise relative flex flex-col items-center px-6 py-8 text-center" data-mode="chat">
        <FloatingShapes layout="hero" />
        <span className="icon-orb icon-orb-lg icon-orb-solid tile-bounce relative" style={{ "--i": 1 } as CSSProperties}>
          <ModeIcon name="chat" size={26} strokeWidth={2} />
        </span>
        <h2
          className="enter-rise relative mt-4 font-heading text-[34px] font-bold leading-[var(--lh-tight)] tracking-[var(--track)] text-[var(--text)]"
          style={{ "--i": 2 } as CSSProperties}
        >
          <span className="text-gradient">{t("chat.empty.headline")}</span>
        </h2>
        <div className="enter-fade relative" style={{ "--i": 3 } as CSSProperties}>
          <ChatKeyStatus />
        </div>
      </div>

      <p className="mt-6 text-center text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-3)]">
        {t("chat.empty.ideas.title")}
      </p>
      <p className="mt-1 text-center text-xs text-[var(--text-3)]" data-testid="chat-ideas-hint">
        {t("chat.empty.ideas.fillsComposer")}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="chat-suggestions">
        {IDEAS.map((id, index) => (
          <button
            key={id}
            type="button"
            className="card-live enter-rise group flex items-start gap-3 px-4 py-4 text-left"
            style={{ "--i": index + 4 } as CSSProperties}
            onClick={() => onSuggest?.(t(`chat.empty.ideas.${id}.prompt`))}
            data-testid="chat-suggestion"
            data-idea={id}
            data-mode={IDEA_MODE[id]}
          >
            <span className="icon-orb icon-orb-solid">
              <IdeaIcon id={id} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--text)]">
                {t(`chat.empty.ideas.${id}.label`)}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--text-3)]">
                {t(`chat.empty.ideas.${id}.hint`)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {needsKey ? null : (
        <p className="enter-fade mt-6 text-center text-sm text-[var(--text-2)]" style={{ "--i": 9 } as CSSProperties}>
          {t("chat.empty.pickModel")}
        </p>
      )}
    </div>
  );
}