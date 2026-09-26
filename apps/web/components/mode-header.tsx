import type { CSSProperties, ReactNode } from "react";
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
}: {
  icon: ModeIconName;
  title: ReactNode;
  outcome?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="hero-glow flex flex-wrap items-end justify-between gap-4" data-testid="mode-header">
      <div className="enter-rise flex min-w-0 items-start gap-4">
        <span className="icon-orb icon-orb-lg icon-orb-solid enter-pop">
          <ModeIcon name={icon} size={24} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h1 className="font-heading text-[length:var(--fs-24)] font-semibold leading-[var(--lh-tight)] tracking-[var(--track)] text-[var(--text)]">
            {title}
          </h1>
          {outcome ? (
            <p className="mt-1.5 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid="expected-inputs">
              {outcome}
            </p>
          ) : null}
          {children}
        </div>
      </div>
      {actions ? (
        <div className="enter-fade flex flex-wrap items-center gap-2" style={{ "--i": 2 } as CSSProperties}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
