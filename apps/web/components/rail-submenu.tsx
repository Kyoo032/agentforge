"use client";

import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/lib/nav";

/**
 * The sub-list a job mode can hang off its rail row — Market's desks, Finance's
 * tasks — extracted from `rail-market-specialists` so both read and behave as
 * one thing. Every rule below was Market's first and still is: the row metrics,
 * the guide rail, the fade, the scroll clamp, the route-derived open state, the
 * chevron that only shows and hides. A mode supplies its rows, its labels and
 * its testids; it does not get to invent its own chrome.
 */

/**
 * The session rows' height, type scale and muted colour (see
 * `rail-recent-threads.tsx`), pulled one notch left: the guide rail supplies the
 * indent here, so the text sits just right of the hairline rather than carrying
 * the full `px-2`.
 */
export const ROW_BASE = "flex h-7 min-w-0 flex-1 items-center rounded-md px-1.5 text-xs tracking-[var(--track)]";

export function rowClass(active: boolean) {
  return active
    ? `select-row ${ROW_BASE} shadow-elev-1 font-medium text-[var(--rail-active-text)] [background-image:var(--grad-soft)]`
    : `wash ${ROW_BASE} text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]`;
}

/**
 * A hairline running down the left of the block, under the mode's icon, so the
 * rows read as a branch off that mode instead of blending into the job mode
 * that follows them. `mb-2` is what keeps the next mode clearly apart underneath.
 */
export const BRANCH = "ml-[22px] mt-1 mb-2 border-l border-[var(--rail-line)] pl-2";

/** One row is `h-7`. */
export const ROW_PX = 28;

/** The block never shrinks below this many rows, and never grows past the catalog. */
export const MIN_ROWS = 4;

/**
 * Everything else the rail has to keep on screen beside this block: the header,
 * the CONVERSE group and its session rows, the ten other job modes, the ACCOUNT
 * group and the footer. Measured on the running rail at 789px with this block
 * closed, plus the branch's own 12px of margin.
 *
 * 789 + 12 is more than a laptop has, so the rail does not fit whatever this
 * block does — rows keep their rhythm and the nav scrolls, rather than every
 * row squashing to hide it. What the subtraction buys is the shape the owner
 * asked for: four rows at 720 and 768, about seven at 900, all of them from
 * 1008 up, instead of a long list crowding out ACCOUNT on every screen.
 */
export const RAIL_RESERVED_PX = 700;

/** Tall monitors show every row; a laptop shows a few and scrolls. */
export function listMaxHeight(rows: number): string {
  return `clamp(${MIN_ROWS * ROW_PX}px, calc(100vh - ${RAIL_RESERVED_PX}px), ${rows * ROW_PX}px)`;
}

/**
 * Open/closed for a mode's sub-list (owner rule 2026-09-17): the list is open
 * exactly while the user is on that mode. Selecting any other rail item —
 * another job mode, Chat, an account page — minimises it, and coming back opens
 * it again. The chevron can still close it while the user is on the mode, but
 * that close is forgotten the moment they leave, so nothing is persisted:
 * `open` is derived from the route, not remembered.
 *
 * Deriving it this way is also what keeps the first paint on the mode's own
 * route already expanded — there is no stored value to read in an effect, so no
 * closed frame.
 */
export function useRailSubmenu(path: string): { open: boolean; toggle: () => void; enabled: boolean } {
  const pathname = usePathname();
  const onMode = pathname === path;
  /** The chevron's close. Only meaningful on the mode, and dropped on leaving. */
  const [closedOnMode, setClosedOnMode] = useState(false);

  useEffect(() => {
    if (!onMode) {
      setClosedOnMode(false);
    }
  }, [onMode]);

  return {
    open: onMode && !closedOnMode,
    enabled: onMode,
    toggle: () => setClosedOnMode((was) => !was),
  };
}

/**
 * The chevron on a mode's row. It only shows or hides the rows: opening the
 * list must not navigate anywhere, so a row is never picked by accident. Off
 * the mode there is nothing to expand — the list belongs to that route — so the
 * chevron reports collapsed and sits inert rather than dead-clicking.
 */
export function RailSubmenuToggle({
  open,
  onToggle,
  enabled = true,
  label,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  enabled?: boolean;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      /* Arrow only (owner ruling 2026-09-23): "Show specialists" and "Show tasks"
         rode beside the mode name, so at a 232px rail Finance truncated to "F."
         and Market lost its label outright — the secondary control was eating the
         primary one. The mode keeps its name and the chevron is a 32px square
         that lines up with the `h-8` row. The words survive in `aria-label` and
         `title`, so nothing is lost to a screen reader or a hover. */
      className="wash flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)] disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={onToggle}
      disabled={!enabled}
      aria-expanded={open}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={open ? "rotate-180" : ""}
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

/** One row: what the mode calls it, where it goes, and what the tooltip says. */
export type RailSubmenuRow = {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly hint: string;
};

/**
 * The rows themselves, parked under their mode's rail entry the way the chat
 * sessions sit under Chat (owner decision 2026-09-17). The row is the way in:
 * the studio reads its id back off the URL rather than offering a second picker.
 */
export function RailSubmenu({
  rows,
  currentId,
  onMode,
  ariaLabel,
  testId,
  branchTestId,
  rowTestId,
}: {
  rows: readonly RailSubmenuRow[];
  /** The id the URL names, so exactly one row can be current. */
  currentId: string;
  /** False off the mode's own route: nothing is current then. */
  onMode: boolean;
  ariaLabel: string;
  testId: string;
  branchTestId: string;
  rowTestId: (id: string) => string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  /*
   * The block scrolls on a short screen, so the row that is open must not be
   * parked out of sight — on mount, and again whenever the URL moves to
   * another row. `nearest` keeps the surrounding nav where it is.
   */
  useEffect(() => {
    if (!onMode) {
      return;
    }
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [onMode, currentId]);

  /*
   * The fade is an affordance, not decoration: it goes on only while rows are
   * actually cut off. The clamp is viewport-relative, so the box is remeasured
   * whenever it resizes rather than once on mount.
   */
  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={BRANCH} data-testid={branchTestId}>
      <div
        ref={listRef}
        /* `mr-1`: this block scrolls too, and its scrollbar would otherwise land
           in the same lane as the nav's and the rail's resize strip. The margin
           parks it inside the branch — padding cannot, a scrollbar sits outside
           the padding box. */
        className="mr-1 overflow-y-auto"
        style={{ maxHeight: listMaxHeight(rows.length) }}
        role="group"
        aria-label={ariaLabel}
        data-testid={testId}
        data-overflowing={overflowing ? "true" : "false"}
      >
        {rows.map((row) => {
          const active = onMode && currentId === row.id;
          return (
            <Link
              key={row.id}
              href={row.href}
              className={rowClass(active)}
              data-testid={rowTestId(row.id)}
              aria-current={active ? "true" : undefined}
              title={row.hint}
            >
              <span className="truncate">{row.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
