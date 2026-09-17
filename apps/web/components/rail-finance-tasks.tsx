"use client";

import { useSearchParams, usePathname } from "@/lib/nav";
import { getLocale, t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { RailSubmenu, RailSubmenuToggle, useRailSubmenu, type RailSubmenuRow } from "@/components/rail-submenu";
import {
  FINANCE_PATH,
  FINANCE_TASKS,
  financeTaskHint,
  financeTaskHref,
  financeTaskLabel,
  taskFromParam,
} from "@/lib/finance-task";

export { FINANCE_PATH, financeTaskHref, taskFromParam };

/** Open exactly while the user is on Finance; see `useRailSubmenu` for the rule. */
export function useRailFinanceTasks(): { open: boolean; toggle: () => void; enabled: boolean } {
  return useRailSubmenu(FINANCE_PATH);
}

/** The chevron on the Finance row. Shows and hides only; it never navigates. */
export function RailFinanceTasksToggle({
  open,
  onToggle,
  enabled = true,
}: {
  open: boolean;
  onToggle: () => void;
  enabled?: boolean;
}) {
  return (
    <RailSubmenuToggle
      open={open}
      onToggle={onToggle}
      enabled={enabled}
      label={open ? t("rail.financeTasksHide") : t("rail.financeTasksToggle")}
      testId="finance-tasks-toggle"
    />
  );
}

/**
 * The Finance tasks, parked under the Finance rail entry exactly the way the
 * Market desks sit under Market. Each task has its own phases and its own math,
 * so the row is the way into a task: the studio reads `?task=` back off the URL
 * rather than offering a second picker. A task that is not built yet still gets
 * a row — the studio says so in one line, which is honest about the roadmap in
 * a way a hidden row is not. Today all five tasks run.
 */
export function RailFinanceTasks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = getLocale();
  const rows: RailSubmenuRow[] = FINANCE_TASKS.map((id) => ({
    id,
    href: financeTaskHref(id),
    label: labeled(`finance.tasks.${id}.label`, financeTaskLabel(id, locale)),
    hint: labeled(`finance.tasks.${id}.hint`, financeTaskHint(id, locale)),
  }));

  return (
    <RailSubmenu
      rows={rows}
      currentId={taskFromParam(searchParams.get("task"))}
      onMode={pathname === FINANCE_PATH}
      ariaLabel={t("rail.financeTasksAria")}
      testId="rail-finance-tasks"
      branchTestId="rail-finance-tasks-branch"
      rowTestId={(id) => `finance-task-${id}`}
    />
  );
}
