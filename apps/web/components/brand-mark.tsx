type Props = {
  size?: number;
  className?: string;
  testId?: string;
  /** When true, the mark sits in a solid gradient tile (rail collapsed header). */
  orb?: boolean;
};

/** Flat double-chevron mark. Accent color comes from `currentColor`. */
export function BrandMark({ size = 28, className, testId, orb = false }: Props) {
  const mark = (
    <svg
      width={orb ? Math.round(size * 0.55) : size}
      height={orb ? Math.round(size * 0.55) : size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={orb ? undefined : className}
      data-testid={orb ? undefined : testId}
    >
      <path
        d="M9 5.25 16.75 12 9 18.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.25 5.25 12 12 4.25 18.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  if (!orb) return mark;
  return (
    <span
      className={`icon-orb icon-orb-solid ${className ?? ""}`}
      style={{ width: size, height: size }}
      data-testid={testId}
    >
      {mark}
    </span>
  );
}
