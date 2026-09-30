import type { GuideOutcome } from "@agentforge/core/guide";

/**
 * The first-run guide as an explicit state machine: `idle | offered | step(n) | done`.
 *
 * Pure, no DOM and no network, so every transition is testable in node. Nothing here knows what a
 * step says or where it points (`guide-steps.ts`), how it is drawn (`components/guide-tour.tsx`) or
 * how the outcome is stored (`guide-store.ts`); this file only decides which state follows which
 * event, and what is owed to the host when one ends.
 *
 * - `idle`     nothing on screen. The tour has not been offered, or the person has not been here yet.
 * - `offered`  the welcome card: "want a quick tour?", with Start, Skip and close.
 * - `step(n)`  step `n` of the registry, zero based.
 * - `done`     over, with how it ended. Terminal, except that a replay starts it again.
 */
export type GuideState =
  | { readonly kind: "idle" }
  | { readonly kind: "offered" }
  | { readonly kind: "step"; readonly index: number }
  | { readonly kind: "done"; readonly outcome: GuideOutcome };

export type GuideEvent =
  | { readonly type: "offer" }
  | { readonly type: "start" }
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "skip" }
  | { readonly type: "close" }
  | { readonly type: "replay" };

export const GUIDE_IDLE: GuideState = { kind: "idle" };

/** The two states in which the tour is on screen. */
export type GuideOpenState = Extract<GuideState, { readonly kind: "offered" | "step" }>;

/** True while the tour is on screen. */
export function isGuideOpen(state: GuideState): state is GuideOpenState {
  return state.kind === "offered" || state.kind === "step";
}

/**
 * The next state, or the same object when the event means nothing here (so a caller can tell
 * "nothing happened" by identity). `stepCount` is the registry's length, passed in so this stays
 * ignorant of the registry.
 *
 * - `offer`   idle -> offered. Never from `done`: a person who has been through the tour, or
 *             dismissed it, in this session is not offered it again.
 * - `start`   offered -> step 0.
 * - `next`    step n -> step n + 1, the last step -> done(finished). On the offer it is `start`.
 * - `back`    step n -> step n - 1. Not on the first step and not on the offer.
 * - `skip`    offered or step -> done(skipped).
 * - `close`   offered or step -> done(closed). The close button and Escape.
 * - `replay`  any state -> step 0. The person asked for it, so it works from `done`, from `idle`
 *             and from the middle of a tour.
 */
export function guideReducer(state: GuideState, event: GuideEvent, stepCount: number): GuideState {
  const last = Math.max(0, stepCount - 1);
  switch (event.type) {
    case "offer":
      return state.kind === "idle" && stepCount > 0 ? { kind: "offered" } : state;
    case "start":
      return state.kind === "offered" ? { kind: "step", index: 0 } : state;
    case "next":
      if (state.kind === "offered") {
        return { kind: "step", index: 0 };
      }
      if (state.kind === "step") {
        return state.index >= last ? { kind: "done", outcome: "finished" } : { kind: "step", index: state.index + 1 };
      }
      return state;
    case "back":
      return state.kind === "step" && state.index > 0 ? { kind: "step", index: state.index - 1 } : state;
    case "skip":
      return isGuideOpen(state) ? { kind: "done", outcome: "skipped" } : state;
    case "close":
      return isGuideOpen(state) ? { kind: "done", outcome: "closed" } : state;
    case "replay":
      return stepCount > 0 ? { kind: "step", index: 0 } : state;
  }
}

/**
 * What the host must be told after a transition: the outcome, exactly when an open tour just ended.
 * A `done` reached any other way (there is none today) owes nothing.
 */
export function outcomeOwed(previous: GuideState, next: GuideState): GuideOutcome | null {
  return isGuideOpen(previous) && next.kind === "done" ? next.outcome : null;
}
