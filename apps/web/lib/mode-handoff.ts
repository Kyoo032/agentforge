/**
 * Renderer-only handoff between work modes ("Make a document from this dossier").
 * Modes stay mounted (WorkModeKeepAlive), so a module-level pending payload plus a
 * window event is enough: no router state, no storage.
 */

export const MODE_HANDOFF_EVENT = "agentforge-mode-handoff";

export const HANDOFF_TARGETS = ["documents", "presentations"] as const;
export type HandoffTarget = (typeof HANDOFF_TARGETS)[number];

export type ModeHandoff = {
  target: HandoffTarget;
  /** Markdown or plain text the target mode uses as its only source of facts. */
  sourceText: string;
  /** Suggested prompt; the user can edit it before generating. */
  prompt: string;
  /** Saved artifact this came from, when one exists. */
  artifactId?: string;
  title?: string;
};

export function isHandoffTarget(value: unknown): value is HandoffTarget {
  return typeof value === "string" && (HANDOFF_TARGETS as readonly string[]).includes(value);
}

export function handoffHref(target: HandoffTarget): string {
  return `/${target}`;
}

const TITLE_MAX = 80;

/** Default prompt for a handoff, phrased for the target mode. */
export function suggestedHandoffPrompt(target: HandoffTarget, title: string): string {
  const subject = title.trim().slice(0, TITLE_MAX) || "the source material";
  if (target === "presentations") {
    return `Turn "${subject}" into a presentation for a decision-maker. Use only the source material.`;
  }
  return `Write a memo from "${subject}". Use only the source material and cite its sources.`;
}

let pending: Partial<Record<HandoffTarget, ModeHandoff>> = {};

/** Queue a handoff and notify the target mode. Returns the href to navigate to. */
export function requestModeHandoff(handoff: ModeHandoff): string {
  pending = { ...pending, [handoff.target]: handoff };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MODE_HANDOFF_EVENT, { detail: { target: handoff.target } }));
  }
  return handoffHref(handoff.target);
}

/** Read and clear the pending handoff for a target (mount-time pickup). */
export function takePendingHandoff(target: HandoffTarget): ModeHandoff | null {
  const found = pending[target] ?? null;
  if (found) {
    const { [target]: _taken, ...rest } = pending;
    pending = rest;
  }
  return found;
}

export function peekPendingHandoff(target: HandoffTarget): ModeHandoff | null {
  return pending[target] ?? null;
}

/** Subscribe a mounted mode; fires immediately if a handoff is already queued. */
export function subscribeModeHandoff(target: HandoffTarget, listener: (handoff: ModeHandoff) => void): () => void {
  const deliver = () => {
    const handoff = takePendingHandoff(target);
    if (handoff) {
      listener(handoff);
    }
  };
  deliver();
  if (typeof window === "undefined") {
    return () => {};
  }
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ target?: unknown }>).detail;
    if (detail?.target === target) {
      deliver();
    }
  };
  window.addEventListener(MODE_HANDOFF_EVENT, onEvent);
  return () => window.removeEventListener(MODE_HANDOFF_EVENT, onEvent);
}

/** Test seam. */
export function clearPendingHandoffs(): void {
  pending = {};
}
