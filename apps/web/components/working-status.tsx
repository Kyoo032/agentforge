/**
 * In-flight status as one pill: bouncing dots, then the existing label.
 * Studios pass the catalog string they already show while a run is busy.
 */
export function WorkingStatus({ label, testId }: { label: string; testId?: string }) {
  return (
    <span className="chip" data-testid={testId}>
      <span className="pulse-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </span>
  );
}
