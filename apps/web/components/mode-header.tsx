import type { CSSProperties, ReactNode } from "react";
import { FloatingShapes } from "@/components/floating-shapes";
import { ModeIcon, type ModeIconName } from "@/components/mode-icons";

/**
 * The header every mode page opens with: a gradient icon tile, the title, and the one
 * outcome line (`expected-inputs`, which the verify recipes read). `actions` sits on the
 * right and wraps under the title on a narrow desk.
 */
export function ModeHeader({
  icon,
  title,
  outcome,
  actions,
  children,
  outcomeTestId = "expected-inputs",
}: {
  icon: ModeIconName;
  title: ReactNode;
  outcome?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Account pages have an intro rather than a mode's outcome line. */
  outcomeTestId?: string;
}) {
  return (
    <header
      className="relative flex flex-wrap items-end justify-between gap-4 pb-2"
      data-testid="mode-header"
      data-mode={icon}
    >
      <FloatingShapes layout="header" className="hidden lg:block" style={{ left: "auto", width: "min(30%, 320px)" }} />
      <div className="enter-rise relative flex min-w-0 items-start gap-4">
        <span className="icon-orb icon-orb-lg icon-orb-solid tile-bounce">
          <ModeIcon name={icon} size={26} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h1 className="font-heading text-[length:var(--fs-24)] font-bold leading-[var(--lh-tight)] tracking-[var(--track)] text-[var(--text)]">
            {title}
          </h1>
          {outcome ? (
            <p className="mt-1.5 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid={outcomeTestId}>
              {outcome}
            </p>
          ) : null}
          {children}
        </div>
      </div>
      {actions ? (
        <div className="enter-fade relative flex flex-wrap items-center gap-2" style={{ "--i": 2 } as CSSProperties}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
