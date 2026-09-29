import type { MascotState } from "@/lib/mascot-states";

/**
 * How the Chat hero's mascot reacts. Two independent facts, a pointer resting on it and a recent
 * tap, fold into one of the mascot's existing states. A tap wins over hover, and hover is still
 * remembered while the celebration plays, so the face settles on the right one afterwards.
 */
export type HeroMood = { hover: boolean; celebrating: boolean };

export type HeroMoodEvent = "enter" | "leave" | "tap" | "settle";

export const INITIAL_HERO_MOOD: HeroMood = { hover: false, celebrating: false };

export function reduceHeroMood(mood: HeroMood, event: HeroMoodEvent): HeroMood {
  switch (event) {
    case "enter":
      return mood.hover ? mood : { ...mood, hover: true };
    case "leave":
      return mood.hover ? { ...mood, hover: false } : mood;
    case "tap":
      return mood.celebrating ? mood : { ...mood, celebrating: true };
    case "settle":
      return mood.celebrating ? { ...mood, celebrating: false } : mood;
  }
}

export function moodState(mood: HeroMood): MascotState {
  if (mood.celebrating) {
    return "celebrating";
  }
  return mood.hover ? "wave" : "idle";
}
