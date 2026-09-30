import type { GuideOutcome } from "@agentforge/core/guide";
import { apiFetch } from "./api-client";
import { GUIDE_IDLE, guideReducer, outcomeOwed, type GuideEvent, type GuideState } from "./guide-machine";
import { GUIDE_STEPS } from "./guide-steps";

/**
 * The one place the first-run guide's state lives while the app runs: a module singleton with a
 * subscribe function, read by `components/guide-tour.tsx` through `useSyncExternalStore` and written
 * by the app shell (offer after onboarding), Settings (replay) and the tour itself.
 *
 * It is a store rather than component state for one reason: the people who start the guide are not
 * its parent. Onboarding ends in `App`, Settings is a route, and the overlay lives in the shell, so
 * a piece of React state would have to be threaded through all three. The transitions are still the
 * pure reducer in `guide-machine.ts`; this file adds the two things the reducer must not know
 * about, the host's answer about whether the guide has been seen, and telling the host how it ended.
 *
 * WHEN IT OPENS ON ITS OWN. Once, after first-run setup: `offerGuideAfterOnboarding` is called from
 * `App` when the onboarding screen finishes, and does nothing if the host says the person has
 * already been through it. Nothing else opens it unprompted, so an install that upgraded into this
 * build, a desk on the stub runtime and the Playwright suite never see it. Settings' "Replay the
 * guide" opens it whenever asked (`replayGuide`).
 */
export type GuideSnapshot = {
  readonly state: GuideState;
  /** What the host last said. `null` until it has said anything, which counts as "not seen yet". */
  readonly seen: boolean | null;
};

let snapshot: GuideSnapshot = { state: GUIDE_IDLE, seen: null };
const listeners = new Set<() => void>();

function publish(next: GuideSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeGuide(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable between changes, as `useSyncExternalStore` requires. */
export function getGuideSnapshot(): GuideSnapshot {
  return snapshot;
}

/** Read `guide` off the settings answer. Anything that is not `{ seen: boolean }` changes nothing. */
export function hydrateGuide(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const seen = (payload as { seen?: unknown }).seen;
  if (typeof seen === "boolean" && seen !== snapshot.seen) {
    publish({ ...snapshot, seen });
  }
}

/**
 * Tell the host how the guide ended. Fire and forget: the tour is already closed on screen, and a
 * host that cannot be reached must not bring it back. `seen` is set locally first for the same
 * reason, so a failed write cannot re-offer the tour during this session.
 */
async function persistOutcome(outcome: GuideOutcome): Promise<void> {
  try {
    await apiFetch("/api/v1/settings/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
  } catch {
    // Not recorded. The worst case is one more offer after the next first-run setup.
  }
}

export function dispatchGuide(event: GuideEvent): void {
  const previous = snapshot.state;
  const next = guideReducer(previous, event, GUIDE_STEPS.length);
  if (next === previous) {
    return;
  }
  const owed = outcomeOwed(previous, next);
  publish({ state: next, seen: owed ? true : snapshot.seen });
  if (owed) {
    void persistOutcome(owed);
  }
}

/** First-run setup just finished. Offers the tour unless the host says it has been seen. */
export function offerGuideAfterOnboarding(): void {
  if (snapshot.seen === true) {
    return;
  }
  dispatchGuide({ type: "offer" });
}

/** Settings' "Replay the guide": straight to the first step, whatever happened before. */
export function replayGuide(): void {
  dispatchGuide({ type: "replay" });
}

export function resetGuideForTests(): void {
  snapshot = { state: GUIDE_IDLE, seen: null };
  listeners.clear();
}
