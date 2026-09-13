"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isInstallAction, updateBadge, updateButtonTitle } from "@/lib/app-updates-copy";
import { useProductBrand } from "@/lib/product-brand";
import { useAppUpdates } from "@/lib/use-app-updates";

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
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={busy ? "animate-pulse" : undefined}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v8" />
      <path d="M8.5 11.5 12 15l3.5-3.5" />
    </svg>
  );
}

/**
 * Rail control for desktop updates: an icon between the theme toggle and the collapse button, with a small
 * panel that carries the status line and the check / install action. Branded flavors render nothing.
 */
export function AppUpdatesButton() {
  const { productName } = useProductBrand();
  const updates = useAppUpdates(productName);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!updates.visible) {
    return null;
  }

  const { state, supported, busy, statusText } = updates;
  const badge = updateBadge(state);
  const install = isInstallAction(state);
  const title = updateButtonTitle(state, supported);

  function toggle() {
    setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen((was) => !was);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0" data-testid="app-updates">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-icon relative h-[30px] w-[30px]"
        onClick={toggle}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        data-testid="app-updates-toggle"
        data-update-badge={badge ?? "none"}
      >
        <UpdateIcon busy={badge === "busy" || busy} />
        {badge === "available" ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent"
            aria-hidden="true"
            data-testid="app-updates-badge"
          />
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Updates"
          className="z-30 rounded-md border border-divider bg-app p-3 shadow-lg"
          style={popoverStyle(anchor)}
          data-testid="app-updates-panel"
        >
          <p className="panel-label">Updates</p>
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
                Update and restart
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="app-updates-check"
                disabled={!supported || busy}
                onClick={() => void updates.check()}
              >
                Check for updates
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={close} data-testid="app-updates-close">
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
