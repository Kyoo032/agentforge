type Props = {
  size?: number;
  className?: string;
  testId?: string;
};

/** Flat double-chevron mark. Accent color comes from `currentColor`. */
export function BrandMark({ size = 28, className, testId }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      data-testid={testId}
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
}
