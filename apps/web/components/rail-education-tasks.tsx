"use client";

import { usePathname, useSearchParams } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { RailSubmenu, RailSubmenuToggle, useRailSubmenu, type RailSubmenuRow } from "@/components/rail-submenu";
import { EDUCATION_PATH, EDUCATION_TASKS, educationTaskHref, taskFromParam } from "@/lib/education-task";

export { EDUCATION_PATH, educationTaskHref, taskFromParam };

/** Open exactly while the user is on Education; see `useRailSubmenu` for the rule. */
export function useRailEducationTasks(): { open: boolean; toggle: () => void; enabled: boolean } {
  return useRailSubmenu(EDUCATION_PATH);
}

/** The chevron on the Education row. Shows and hides only; it never navigates. */
export function RailEducationTasksToggle({
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
      label={open ? t("rail.educationTasksHide") : t("rail.educationTasksToggle")}
      word={t("rail.educationTasksWord")}
      testId="education-tasks-toggle"
    />
  );
}

/**
 * Lesson, Quiz, A page, and Show, parked under the Education rail entry the
 * way Finance tasks sit under Finance. The row is the way into a task: the
 * studio reads `?task=` back off the URL rather than offering a second picker.
 */
export function RailEducationTasks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rows: RailSubmenuRow[] = EDUCATION_TASKS.map((id) => ({
    id,
    href: educationTaskHref(id),
    label: t(`education.tasks.${id}.label`),
    hint: t(`education.tasks.${id}.hint`),
  }));

  return (
    <RailSubmenu
      rows={rows}
      currentId={taskFromParam(searchParams.get("task"))}
      onMode={pathname === EDUCATION_PATH}
      ariaLabel={t("rail.educationTasksAria")}
      testId="rail-education-tasks"
      branchTestId="rail-education-tasks-branch"
      rowTestId={(id) => `education-task-${id}`}
    />
  );
}
