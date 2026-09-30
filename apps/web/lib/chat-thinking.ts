import { isReasoningEffort, type ReasoningEffort } from "@agentforge/core/reasoning-effort";

/**
 * The Thinking level Chat sends, and whether the person chose it.
 *
 * The picker always shows a level (it starts at Normal), but a level nobody picked is not a request.
 * The host reads a body with no `reasoningEffort` as "defaulted" (`readReasoningEffortChoice`), and the
 * runtime then sends a model the policy table does not know no effort at all instead of Normal. So the
 * request carries the level only once the person has picked one; what the picker shows does not change.
 */

/** The picker's level, written whenever the person picks one (never by a default). */
export const THINKING_EFFORT_STORAGE_KEY = "agentforge-chat-reasoning-effort";
/** The on/off switch older builds wrote beside it. Read for a person who has not picked a level since. */
export const THINKING_LEGACY_STORAGE_KEY = "agentforge-chat-thinking";

export type ThinkingPref = { effort: ReasoningEffort; chosen: boolean };

/** Where an untouched picker starts: Normal, not chosen. */
export const DEFAULT_THINKING_PREF: ThinkingPref = Object.freeze({ effort: "medium", chosen: false });

type ThinkingStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: ThinkingStorage | undefined, key: string): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * What the picker starts at on this browser. A stored level is a choice, because only the picker
 * writes it; so is the older "off" switch. Nothing stored (or storage blocked) is the untouched default.
 */
export function readStoredThinkingPref(storage: ThinkingStorage | undefined): ThinkingPref {
  const storedEffort = read(storage, THINKING_EFFORT_STORAGE_KEY);
  if (isReasoningEffort(storedEffort) && storedEffort !== "minimal") {
    return { effort: storedEffort, chosen: true };
  }
  if (read(storage, THINKING_LEGACY_STORAGE_KEY) === "off") {
    return { effort: "none", chosen: true };
  }
  return DEFAULT_THINKING_PREF;
}

/** Remember a level the person picked, in both keys so an older build reads the same answer. */
export function writeThinkingPref(effort: ReasoningEffort, storage: ThinkingStorage | undefined): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(THINKING_EFFORT_STORAGE_KEY, effort);
    storage.setItem(THINKING_LEGACY_STORAGE_KEY, effort === "none" ? "off" : "on");
  } catch {
    // private mode
  }
}

/**
 * The Thinking fields of a run request. Nothing until the person picked a level; then the level and
 * the on/off flag beside it, exactly as the composer always posted them.
 */
export function thinkingRequestFields(
  effort: ReasoningEffort,
  chosen: boolean,
): { thinking?: boolean; reasoningEffort?: ReasoningEffort } {
  if (!chosen) {
    return {};
  }
  return { thinking: effort !== "none", reasoningEffort: effort };
}
