import type { CSSProperties } from "react";

const COLORS = ["var(--mode, var(--accent))", "var(--accent-2)", "var(--accent-3)", "var(--accent-4)", "var(--mode-finance)", "var(--mode-edit)"];
const PIECES = 26;

/* Deterministic spread so the burst looks the same every time and needs no randomness. */
const SPREAD = Array.from({ length: PIECES }, (_, i) => {
  const angle = (i / PIECES) * Math.PI * 2;
  const reach = 70 + ((i * 37) % 60);
  return {
    x: `${Math.round(Math.cos(angle) * reach * 1.6)}px`,
    y: `${Math.round(Math.sin(angle) * reach + 40)}px`,
    r: `${((i * 83) % 540) - 270}deg`,
    color: COLORS[i % COLORS.length],
  };
});

/**
 * A one-shot burst over the top-centre of its positioned parent. Mount it with a `key` that
 * changes per result (an artifact id, a run count) so it fires once when that result lands.
 */
export function Confetti() {
  return (
    <span className="confetti" aria-hidden="true">
      {SPREAD.map((piece, index) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout
          key={index}
          style={{ "--x": piece.x, "--y": piece.y, "--r": piece.r, "--i": index, background: piece.color } as CSSProperties}
        />
      ))}
    </span>
  );
}
