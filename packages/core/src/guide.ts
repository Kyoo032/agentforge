/**
 * The first-run guide's persisted record: whether the person has been through the tour, and how it
 * ended. Shared by the host (which stores and validates it) and the renderer (which shows the tour),
 * so the three outcomes have one spelling.
 *
 * It says nothing about what the tour contains. The steps live in the renderer
 * (`apps/web/lib/guide-steps.ts`); this is only the "never auto-open it again" bit and how it was
 * dismissed, kept beside the language choice in the sealed settings payload (`settings-store.ts`) so
 * it is machine-wide on a desk and is removed by the same "Start over" that removes the language.
 */
export const GUIDE_OUTCOMES = ["finished", "skipped", "closed"] as const;

export type GuideOutcome = (typeof GUIDE_OUTCOMES)[number];

export function isGuideOutcome(value: unknown): value is GuideOutcome {
  return typeof value === "string" && (GUIDE_OUTCOMES as readonly string[]).includes(value);
}

export type GuideRecord = {
  readonly outcome: GuideOutcome;
  /** Epoch milliseconds the outcome was recorded. */
  readonly at: number;
};

/** What `GET /api/v1/settings` carries as `guide`. `seen` is the only thing the renderer branches on. */
export type GuidePayload = {
  readonly seen: boolean;
  readonly outcome: GuideOutcome | null;
  readonly at: number | null;
};

/** Anything unreadable is "never seen": a tour that shows once too often costs a click, never data. */
export function parseGuideRecord(value: unknown): GuideRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const { outcome, at } = value as { outcome?: unknown; at?: unknown };
  if (!isGuideOutcome(outcome) || typeof at !== "number" || !Number.isFinite(at) || at < 0) {
    return null;
  }
  return { outcome, at };
}

export function guidePayload(record: GuideRecord | null): GuidePayload {
  return record
    ? { seen: true, outcome: record.outcome, at: record.at }
    : { seen: false, outcome: null, at: null };
}
