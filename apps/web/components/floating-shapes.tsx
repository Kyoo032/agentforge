import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { pokeShape, REDUCED_MOTION_QUERY } from "@/lib/hero-motion";

type Shape = {
  kind: "dot" | "ring" | "square" | "plus" | "squiggle" | "triangle";
  /** Position inside the parent, as CSS lengths. */
  at: { top?: string; right?: string; bottom?: string; left?: string };
  size: number;
  color: string;
  spin?: boolean;
  /** How far, in px, the shape drifts at full pointer deflection. Negative drifts against it. */
  depth?: number;
  /** 1 always shows; 2 and 3 appear as the hero's column gets wider (`.chat-hero`, `.onboarding-hero` in globals.css). */
  tier?: 1 | 2 | 3;
};

const LAYOUTS: Record<"header" | "hero" | "chat", Shape[]> = {
  header: [
    { kind: "dot", at: { top: "22%", right: "8%" }, size: 16, color: "var(--mode, var(--accent))" },
    { kind: "ring", at: { top: "46%", right: "30%" }, size: 26, color: "var(--accent-3)", spin: true },
    { kind: "plus", at: { top: "4%", right: "56%" }, size: 18, color: "var(--accent-4)", spin: true },
    { kind: "square", at: { bottom: "6%", right: "4%" }, size: 18, color: "var(--accent-2)" },
    { kind: "squiggle", at: { top: "26%", right: "62%" }, size: 38, color: "var(--mode, var(--accent))" },
    { kind: "triangle", at: { bottom: "4%", right: "44%" }, size: 16, color: "var(--mode, var(--accent))" },
  ],
  /*
   * The onboarding hero (`StepHero`). Every shape sits in a band either side of the 96px character (its
   * top edge is the hero's 2rem padding) and above the headline, so none can lie on the character, the
   * headline or the intro text, which fill the column at a narrow width. Tier 1 always shows; 2 from 26rem
   * of hero width and 3 from 44rem, as in the Chat hero (`.onboarding-hero` in globals.css).
   */
  hero: [
    { kind: "dot", at: { top: "3.25rem", left: "10%" }, size: 16, color: "var(--accent-4)" },
    { kind: "ring", at: { top: "2.5rem", right: "10%" }, size: 26, color: "var(--mode, var(--accent))", spin: true },
    { kind: "triangle", at: { top: "6.5rem", left: "6%" }, size: 20, color: "var(--mode, var(--accent))", tier: 2 },
    { kind: "plus", at: { top: "5rem", right: "6%" }, size: 20, color: "var(--accent-3)", spin: true, tier: 2 },
    { kind: "squiggle", at: { top: "2.25rem", right: "28%" }, size: 38, color: "var(--accent-3)", tier: 3 },
  ],
  /*
   * The empty Chat hero. Tier 1 sits in the band either side of the mascot, which is free at any
   * width; the rest only appear where the column has room, and stay in the outer columns so they
   * never sit behind the headline or the status pill.
   */
  chat: [
    { kind: "dot", at: { top: "10%", left: "9%" }, size: 14, color: "var(--accent-4)", depth: 12 },
    {
      kind: "ring",
      at: { top: "8%", right: "9%" },
      size: 24,
      color: "var(--mode, var(--accent))",
      spin: true,
      depth: -16,
    },
    {
      kind: "triangle",
      at: { top: "44%", left: "4%" },
      size: 18,
      color: "var(--mode, var(--accent))",
      depth: -10,
      tier: 2,
    },
    {
      kind: "plus",
      at: { top: "50%", right: "4%" },
      size: 18,
      color: "var(--accent-3)",
      spin: true,
      depth: 14,
      tier: 2,
    },
    { kind: "square", at: { bottom: "12%", left: "6%" }, size: 16, color: "var(--accent-2)", depth: 18, tier: 2 },
    { kind: "squiggle", at: { top: "14%", right: "26%" }, size: 36, color: "var(--accent-3)", depth: -8, tier: 3 },
    {
      kind: "dot",
      at: { bottom: "16%", right: "8%" },
      size: 10,
      color: "var(--mode, var(--accent))",
      depth: 8,
      tier: 3,
    },
  ],
};

function glyph(kind: Shape["kind"], color: string): ReactNode {
  switch (kind) {
    case "dot":
      return <circle cx="12" cy="12" r="10" fill={color} />;
    case "ring":
      return <circle cx="12" cy="12" r="8.5" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray="10 5" />;
    case "square":
      return <rect x="3" y="3" width="18" height="18" rx="5" fill={color} />;
    case "plus":
      return <path d="M12 3v18M3 12h18" stroke={color} strokeWidth="4.5" strokeLinecap="round" />;
    case "triangle":
      return <path d="M12 3.5 21 19.5H3z" fill={color} strokeLinejoin="round" />;
    default:
      return (
        <path
          d="M1 14c2.5-6 5-6 7.5 0s5 6 7.5 0 5-6 7 0"
          fill="none"
          stroke={color}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      );
  }
}

function pokeFromPointer(event: PointerEvent<HTMLDivElement>) {
  const target = event.target;
  const shape = target instanceof Element ? target.closest(".float-shape") : null;
  if (shape) {
    pokeShape(shape, window.matchMedia(REDUCED_MOTION_QUERY).matches);
  }
}

/**
 * Decorative only: shapes behind a hero or a mode header. They settle into place once when they
 * arrive and then rest; nothing here loops (`.float-shape` in globals.css says why, and
 * `lib/motion-tokens.test.ts` enforces it). `interactive` lets them drift with the hero's pointer
 * variables (`--px`, `--py`, set by `attachHeroMotion`, only while the pointer moves) and pop when
 * tapped; the container still ignores the pointer, only the shapes take it.
 */
export function FloatingShapes({
  layout,
  className = "",
  style,
  interactive = false,
}: {
  layout: keyof typeof LAYOUTS;
  className?: string;
  style?: CSSProperties;
  interactive?: boolean;
}) {
  return (
    <div
      className={`float-shapes ${interactive ? "float-shapes-live" : ""} ${className}`}
      style={style}
      aria-hidden="true"
      onPointerDown={interactive ? pokeFromPointer : undefined}
    >
      {LAYOUTS[layout].map((shape, index) => (
        <svg
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout
          key={index}
          className={shape.spin ? "float-shape float-shape-spin" : "float-shape"}
          width={shape.size}
          height={shape.size}
          viewBox="0 0 24 24"
          data-tier={shape.tier ?? 1}
          style={{ ...shape.at, "--i": index, "--s": shape.size, "--depth": shape.depth ?? 0 } as CSSProperties}
        >
          {glyph(shape.kind, shape.color)}
        </svg>
      ))}
    </div>
  );
}
