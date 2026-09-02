"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PRODUCT_MODES,
  firstVisibleHref,
  productModeMatches,
  type ProductMode,
} from "@agentforge/core/product-modes";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { getRailCollapsed, setRailCollapsed } from "@/lib/rail-prefs";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
};

function itemClass(active: boolean, compact = false) {
  return active
    ? `${compact ? "flex justify-center" : "block"} rounded-md bg-navy ${compact ? "px-2 py-2" : "px-2.5 py-1.5"} text-sm text-white`
    : `${compact ? "flex justify-center" : "block"} rounded-md ${compact ? "px-2 py-2" : "px-2.5 py-1.5"} text-sm text-ink hover:bg-mist`;
}

export function AppRail({ workspaceName, visibleModes }: Props) {
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/settings");
  const onWorkspaces = pathname.startsWith("/workspaces");
  const [collapsed, setCollapsed] = useState(false);
  const modes = PRODUCT_MODES.filter((mode) => visibleModes.includes(mode.id));
  const homeHref = firstVisibleHref(visibleModes);

  useEffect(() => {
    setCollapsed(getRailCollapsed());
  }, []);

  function toggleCollapsed() {
    setCollapsed((was) => {
      const next = !was;
      setRailCollapsed(next);
      return next;
    });
  }

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-11 shrink-0 flex-col items-center rounded-xl border border-mist/80 bg-paper py-3"
        aria-label="Product modes"
      >
        <button
          type="button"
          className="rounded-md px-1.5 py-1 text-sm text-ink/60 hover:bg-mist hover:text-ink"
          onClick={toggleCollapsed}
          data-testid="rail-expand"
          aria-label="Expand navigation"
          title="Expand navigation"
        >
          »
        </button>
        <nav className="mt-3 flex flex-col items-center gap-1" aria-label="Modes">
          {modes.map((mode) => {
            const isActive = productModeMatches(mode.id, pathname);
            return (
              <Link
                key={mode.href}
                href={mode.href}
                className={`${itemClass(isActive, true)} text-xs font-medium`}
                title={mode.label}
                aria-label={mode.label}
                aria-current={isActive ? "page" : undefined}
                data-testid={`mode-${mode.href.slice(1)}`}
              >
                {mode.label.slice(0, 1)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <WorkspaceSwitcher workspaceName={workspaceName} compact />
          <Link
            href="/workspaces"
            className={`${itemClass(onWorkspaces, true)} text-xs font-medium`}
            data-testid="workspaces-link"
            title="Workspaces"
            aria-label="Workspaces"
            aria-current={onWorkspaces ? "page" : undefined}
          >
            Ws
          </Link>
          <Link
            href="/settings"
            className={`${itemClass(onSettings, true)} text-xs font-medium`}
            data-testid="settings-link"
            title="Settings"
            aria-label="Settings"
            aria-current={onSettings ? "page" : undefined}
          >
            Set
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col rounded-xl border border-mist/80 bg-paper" aria-label="Product modes">
      <div className="flex items-start gap-1 border-b border-mist px-2 py-3">
        <div className="min-w-0 flex-1">
          <Link href={homeHref} className="block truncate text-sm font-semibold tracking-tight text-ink">
            Agentforge
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink/50">{workspaceName}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-1 text-sm text-ink/60 hover:bg-mist hover:text-ink"
          onClick={toggleCollapsed}
          data-testid="rail-collapse"
          aria-label="Collapse navigation"
          title="Collapse navigation"
        >
          «
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3" aria-label="Modes">
        <div className="space-y-0.5">
          {modes.map((mode) => {
            const isActive = productModeMatches(mode.id, pathname);
            return (
              <Link
                key={mode.href}
                href={mode.href}
                className={itemClass(isActive)}
                aria-current={isActive ? "page" : undefined}
                data-testid={`mode-${mode.href.slice(1)}`}
              >
                {mode.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="space-y-0.5 border-t border-mist px-2 py-3">
        <WorkspaceSwitcher workspaceName={workspaceName} />
        <Link
          href="/workspaces"
          className={itemClass(onWorkspaces)}
          data-testid="workspaces-link"
          aria-current={onWorkspaces ? "page" : undefined}
        >
          Workspaces
        </Link>
        <Link
          href="/settings"
          className={itemClass(onSettings)}
          data-testid="settings-link"
          aria-current={onSettings ? "page" : undefined}
        >
          Settings
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
