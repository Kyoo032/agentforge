import type { ReactNode } from "react";

/**
 * Pages that pin their own chrome (composer, timeline) and scroll an inner
 * region. Every other desk page scrolls this pane and nothing above it.
 */
export const FILL_DESK_PATHS = new Set(["/chat", "/edit"]);

/** Scrollport classes. Kept stable on a mounted node so `scrollTop` survives a hide. */
export function deskPaneClass(fill: boolean): string {
  return fill
    ? "absolute inset-0 min-h-0 overflow-hidden"
    : "absolute inset-0 min-h-0 overflow-x-hidden overflow-y-auto";
}

export function deskPaneInnerClass(fill: boolean): string {
  return fill ? "page-enter h-full min-h-0" : "page-enter min-h-full";
}

type Props = {
  /** Chat and Edit. The pane stays put; the page scrolls inside itself. */
  fill?: boolean;
  children: ReactNode;
};

/**
 * The one scrollport for a desk page that mounts with the route (Settings,
 * Knowledge, Workspaces). Work modes use the same classes on a node that stays
 * mounted — see `WorkModeKeepAlive`.
 *
 * The shell around it is `overflow-hidden`, so the document never grows a
 * second bar. Entrance motion sits on the inner wrapper: a transform on the
 * scrollport itself stays after `animation-fill-mode: both` and becomes the
 * containing block for fixed menus, which then clip.
 */
export function DeskPane({ fill = false, children }: Props) {
  return (
    <div className={deskPaneClass(fill)}>
      <div className={deskPaneInnerClass(fill)}>{children}</div>
    </div>
  );
}
