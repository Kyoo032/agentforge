"use client";

import { type CSSProperties, useEffect, useReducer, useRef, useState } from "react";
import { ChatKeyStatus } from "@/components/chat-key-status";
import { Confetti } from "@/components/confetti";
import { FloatingShapes } from "@/components/floating-shapes";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import { warmMascot } from "@/components/nultron/nx-warm";
import { INITIAL_HERO_MOOD, moodState, reduceHeroMood } from "@/lib/hero-mood";
import { t } from "@/lib/i18n";
import { HERO_NEXT } from "@/lib/mascot-triggers";
import { useHeroMotion } from "@/lib/use-hero-motion";

/** How long the mascot cheers after a tap, and how long the confetti stays mounted. */
const CHEER_MS = 1400;
const CONFETTI_MS = 1600;

/**
 * The empty Chat's hero: the mascot, one headline, the key status.
 *
 * Everything is sized from the width of the column it sits in (`cqi`, see `.chat-hero` in
 * globals.css), not the viewport, because the desk is often narrower than the window: a phone,
 * or the rail open beside a small pane. It reacts to the pointer in three cheap ways: the shapes
 * drift and the mascot's eyes follow (`useHeroMotion`), the mascot waves on hover, and a tap on it
 * cheers with a confetti burst. Tapping a shape pops it. Reduced motion turns all of that off.
 *
 * The wave and the cheer are clips (40 to 150 KB each), fetched only when the pointer, focus or a touch
 * reaches the hero, which is before the orb itself is reached; their stills are fetched when idle
 * (`next`). Nothing else about the character loads with the page.
 */
export function ChatHero() {
  const hero = useRef<HTMLElement>(null);
  const [mood, dispatch] = useReducer(reduceHeroMood, INITIAL_HERO_MOOD);
  const [burst, setBurst] = useState(0);
  useHeroMotion(hero);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a second tap changes `burst` and re-arms the cheer timer
  useEffect(() => {
    if (!mood.celebrating) {
      return;
    }
    const timer = window.setTimeout(() => dispatch("settle"), CHEER_MS);
    return () => window.clearTimeout(timer);
  }, [mood.celebrating, burst]);

  useEffect(() => {
    if (burst === 0) {
      return;
    }
    const timer = window.setTimeout(() => setBurst(0), CONFETTI_MS);
    return () => window.clearTimeout(timer);
  }, [burst]);

  const state = moodState(mood);
  const warmClips = () => warmMascot(HERO_NEXT, "full", { still: false });

  return (
    <section
      ref={hero}
      className="chat-hero enter-rise relative"
      data-testid="chat-hero"
      data-mode="chat"
      onPointerEnter={warmClips}
      onPointerDown={warmClips}
      onFocus={warmClips}
    >
      <div className="hero-aurora chat-hero-panel relative flex flex-col items-center text-center">
        <FloatingShapes layout="chat" interactive />
        <button
          type="button"
          className="chat-hero-orb tile-bounce relative"
          style={{ "--i": 1 } as CSSProperties}
          aria-label={t("chat.empty.mascotHello")}
          data-testid="chat-hero-mascot"
          data-mood={state}
          onPointerEnter={() => dispatch("enter")}
          onPointerLeave={() => dispatch("leave")}
          onFocus={() => dispatch("enter")}
          onBlur={() => dispatch("leave")}
          onClick={() => {
            dispatch("tap");
            setBurst((count) => count + 1);
          }}
        >
          <NultronMascot state={state} variant="full" decorative next={HERO_NEXT} />
        </button>
        <h2
          className="chat-hero-title enter-rise relative font-heading font-bold tracking-[var(--track)] text-[var(--text)]"
          style={{ "--i": 2 } as CSSProperties}
        >
          <span className="text-gradient">{t("chat.empty.headline")}</span>
        </h2>
        <div className="enter-fade relative w-full" style={{ "--i": 3 } as CSSProperties}>
          <ChatKeyStatus />
        </div>
      </div>
      {burst > 0 ? (
        <div className="chat-hero-burst" aria-hidden="true">
          <Confetti key={burst} />
        </div>
      ) : null}
    </section>
  );
}
