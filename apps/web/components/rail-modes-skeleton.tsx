import type { CSSProperties } from "react";

/**
 * The rail's job-mode rows while the shell does not yet know which modes the desk has (a brand-new
 * install, before `GET /api/v1/workspaces` answers; see `lib/shell-modes.ts`).
 *
 * It exists so the rail never draws a mode the desk lacks, and so the account links below it start
 * where they will end up. Same rows as `RailItem` (`h-8`, a 24px tile, a label), drawn as plain
 * blocks. It is deliberately still: no shimmer, no pulse, no loop. The renderer has no decorative
 * animation left (`lib/motion-tokens.test.ts`), and a skeleton that lasts one round trip has no
 * business being the exception. It is `aria-hidden`; the nav carries `aria-busy` while it shows.
 */
const LABEL_WIDTHS: readonly string[] = ["58%", "44%", "52%", "38%"];

const BLOCK = "bg-[color-mix(in_srgb,var(--rail-text-3)_18%,transparent)]";

export function RailModesSkeleton({ collapsed, rows }: { collapsed: boolean; rows: number }) {
  // Rows have no identity and never reorder; the keys are made once, up front.
  const keys = Array.from({ length: rows }, (_, index) => `skeleton-row-${index}`);
  return (
    <div className="flex shrink-0 flex-col" aria-hidden="true" data-testid="rail-modes-skeleton">
      {keys.map((key, index) => (
        <div
          key={key}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-2 ${collapsed ? "justify-center" : ""}`}
          data-testid="rail-modes-skeleton-row"
        >
          <span className={`inline-flex h-6 w-6 shrink-0 rounded-lg ${BLOCK}`} />
          {collapsed ? null : (
            <span
              className={`h-2.5 rounded-sm ${BLOCK}`}
              style={{ width: LABEL_WIDTHS[index % LABEL_WIDTHS.length] } as CSSProperties}
            />
          )}
        </div>
      ))}
    </div>
  );
}
