"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { isInstallAction, updateBadge, updateButtonTitle, updateCtaKind } from "@/lib/app-updates-copy";
import { useProductBrand } from "@/lib/product-brand";
import { useAppUpdates } from "@/lib/use-app-updates";
import { t } from "@/lib/i18n";

const POPOVER_WIDTH = 272;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;

/** The rail is `overflow-hidden`, so the panel is fixed to the viewport and anchored above the icon. */
function popoverStyle(anchor: DOMRect | null): CSSProperties {
  if (!anchor) {
    return { position: "fixed", left: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN, width: POPOVER_WIDTH };
  }
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
  return {
    position: "fixed",
    left: Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft),
    bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - anchor.top + POPOVER_GAP),
    width: POPOVER_WIDTH,
  };
}

function UpdateIcon({ busy }: { busy: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      aria-busy={busy || undefined}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v8" />
      <path d="M8.5 11.5 12 15l3.5-3.5" />
    </svg>
  );
}

function ctaLabel(kind: ReturnType<typeof updateCtaKind>): string | null {
  if (kind === "ready") {
    return t("rail.updates.ctaReady");
  }
  if (kind === "downloading") {
    return t("rail.updates.ctaDownloading");
  }
  if (kind === "available") {
    return t("rail.updates.ctaAvailable");
  }
  return null;
}

/**
 * Rail control for desktop updates. Idle retracts to an icon. A downloadable release expands into a
 * labeled primary button (icon-only when the rail is collapsed) so the update is not a 2px dot.
 */
export function AppUpdatesButton({ collapsed = false }: { collapsed?: boolean }) {
  const { productName } = useProductBrand();
  const updates = useAppUpdates(productName);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!updates.visible) {
    return null;
  }

  const { state, supported, busy, statusText } = updates;
  const badge = updateBadge(state);
  const cta = updateCtaKind(state);
  const install = isInstallAction(state);
  const title = updateButtonTitle(state, supported);
  const expanded = Boolean(cta) && !collapsed;
  const label = ctaLabel(cta);

  function toggle() {
    setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen((was) => !was);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={expanded ? "relative min-w-0 flex-1" : "relative shrink-0"}
      data-testid="app-updates"
    >
      <button
        ref={buttonRef}
        type="button"
        className={
          expanded
            ? "btn btn-primary inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 px-2 text-xs font-medium"
            : cta
              ? "btn btn-primary btn-icon relative h-8 w-8"
              : "btn btn-ghost btn-icon relative h-8 w-8 text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]"
        }
        onClick={toggle}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        data-testid="app-updates-toggle"
        data-update-badge={badge ?? "none"}
        data-update-cta={cta ?? "none"}
      >
        <UpdateIcon busy={badge === "busy" || busy} />
        {expanded && label ? <span className="min-w-0 truncate">{label}</span> : null}
        {cta ? (
          <span className="sr-only" data-testid="app-updates-badge">
            {label}
          </span>
        ) : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t("rail.updates.panel")}
              className="z-50 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-raise)]"
              style={popoverStyle(anchor)}
              data-testid="app-updates-panel"
            >
              <p className="panel-label">{t("rail.updates.panel")}</p>
              <p className="mt-2 break-words text-sm text-inkbase" data-testid="app-updates-status">
                {statusText}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {supported && install ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="app-updates-install"
                    disabled={busy || state.status === "downloading"}
                    onClick={() => void updates.updateAndRestart()}
                  >
                    {t("rail.updates.install")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="app-updates-check"
                    disabled={!supported || busy}
                    onClick={() => void updates.check()}
                  >
                    {t("rail.updates.check")}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={close} data-testid="app-updates-close">
                  {t("rail.updates.close")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
