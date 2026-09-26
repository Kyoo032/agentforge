import type { CSSProperties, ReactNode } from "react";

type Shape = {
  kind: "dot" | "ring" | "square" | "plus" | "squiggle" | "triangle";
  /** Position inside the parent, as CSS lengths. */
  at: { top?: string; right?: string; bottom?: string; left?: string };
  size: number;
  color: string;
  spin?: boolean;
};

const LAYOUTS: Record<"header" | "hero", Shape[]> = {
  header: [
    { kind: "dot", at: { top: "22%", right: "8%" }, size: 16, color: "var(--mode, var(--accent))" },
    { kind: "ring", at: { top: "46%", right: "30%" }, size: 26, color: "var(--accent-3)", spin: true },
    { kind: "plus", at: { top: "4%", right: "56%" }, size: 18, color: "var(--accent-4)", spin: true },
    { kind: "square", at: { bottom: "6%", right: "4%" }, size: 18, color: "var(--accent-2)" },
    { kind: "squiggle", at: { top: "26%", right: "62%" }, size: 38, color: "var(--mode, var(--accent))" },
    { kind: "triangle", at: { bottom: "4%", right: "44%" }, size: 16, color: "var(--mode, var(--accent))" },
  ],
  hero: [
    { kind: "dot", at: { top: "14%", left: "10%" }, size: 16, color: "var(--accent-4)" },
    { kind: "ring", at: { top: "22%", right: "12%" }, size: 28, color: "var(--mode, var(--accent))", spin: true },
    { kind: "square", at: { bottom: "18%", left: "16%" }, size: 18, color: "var(--accent-2)" },
    { kind: "plus", at: { bottom: "22%", right: "18%" }, size: 20, color: "var(--accent-3)", spin: true },
    { kind: "triangle", at: { top: "58%", left: "6%" }, size: 20, color: "var(--mode, var(--accent))" },
    { kind: "squiggle", at: { top: "10%", right: "34%" }, size: 38, color: "var(--accent-3)" },
    { kind: "dot", at: { bottom: "10%", right: "40%" }, size: 10, color: "var(--mode, var(--accent))" },
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

/** Decorative only: bobbing and spinning shapes behind a hero or a mode header. */
export function FloatingShapes({
  layout,
  className = "",
  style,
}: {
  layout: keyof typeof LAYOUTS;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`float-shapes ${className}`} style={style} aria-hidden="true">
      {LAYOUTS[layout].map((shape, index) => (
        <svg
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout
          key={index}
          className={shape.spin ? "float-shape float-shape-spin" : "float-shape"}
          width={shape.size}
          height={shape.size}
          viewBox="0 0 24 24"
          style={{ ...shape.at, "--i": index } as CSSProperties}
        >
          {glyph(shape.kind, shape.color)}
        </svg>
      ))}
    </div>
  );
}
