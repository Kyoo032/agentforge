"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@/lib/nav";
import { usePathname } from "@/lib/nav";
import { PRODUCT_MODES, firstVisibleHref, productModeMatches, type ProductMode } from "@agentforge/core/product-modes";
import { AppUpdatesButton } from "@/components/app-updates";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { getRailCollapsed, setRailCollapsed } from "@/lib/rail-prefs";
import { RAIL_WIDTH, RAIL_WIDTH_KEY } from "@/lib/panel-width";
import { usePanelWidth } from "@/lib/use-panel-width";
import { PanelResizeHandle } from "@/components/panel-resize-handle";
import { RailRecentThreads } from "@/components/rail-recent-threads";
import { RailFinanceTasks, RailFinanceTasksToggle, useRailFinanceTasks } from "@/components/rail-finance-tasks";
import {
  RailMarketSpecialists,
  RailMarketSpecialistsToggle,
  useRailMarketSpecialists,
} from "@/components/rail-market-specialists";
import { useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";
import { productMonogram } from "@/components/app-shell";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
};

type IconName =
  | "chat"
  | "documents"
  | "research"
  | "finance"
  | "data"
  | "market"
  | "legal"
  | "images"
  | "videos"
  | "music"
  | "edit"
  | "presentations"
  | "knowledge"
  | "channels"
  | "workspaces"
  | "usage"
  | "settings";

const RAIL_ICON_PATHS: Record<IconName, ReactNode> = {
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  documents: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8" />
    </>
  ),
  research: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  finance: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M17 7h4v4" />
      <path d="M3 21h18" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  market: (
    <>
      <rect x="4" y="9" width="4" height="7" />
      <path d="M6 5v4M6 16v3" />
      <rect x="14" y="6" width="4" height="8" />
      <path d="M16 3v3M16 14v5" />
      <path d="M3 21h18" />
    </>
  ),
  legal: (
    <>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="m5 7-3 7a3 3 0 0 0 6 0z" />
      <path d="m19 7-3 7a3 3 0 0 0 6 0z" />
      <path d="M8 21h8" />
    </>
  ),
  images: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  videos: (
    <>
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  edit: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m8.5 7.5 12 9" />
      <path d="m8.5 16.5 12-9" />
    </>
  ),
  presentations: (
    <>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </>
  ),
  knowledge: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v18H6.2A2.2 2.2 0 0 1 4 18.8Z" />
      <path d="M8 7h7M8 11h7" />
    </>
  ),
  channels: (
    <>
      <path d="M21 4 3 11l6 2.5L21 4Z" />
      <path d="m21 4-9 16-2.5-6.5" />
    </>
  ),
  workspaces: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  usage: (
    <>
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <path d="m12 14 4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
};

function RailIcon({ name }: { name: IconName }) {
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
    >
      {RAIL_ICON_PATHS[name]}
    </svg>
  );
}

function RailItem({
  href,
  label,
  icon,
  active,
  collapsed,
  testId,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  collapsed: boolean;
  testId: string;
}) {
  return (
    <Link
      href={href}
      /* `shrink-0`: the nav is a column flex box, so without it a rail that runs
         past the viewport squashes these rows (32px down to 23px at 640) while a
         row wrapped in anything — the session block, Market's chevron row — keeps
         its height and reads as though it had extra space around it. The nav
         already scrolls; rows keep their rhythm instead. */
      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-sm tracking-[var(--track)] ${
        active
          ? "select-row bg-[var(--accent-soft)] text-[var(--accent)]"
          : "wash text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
      } ${collapsed ? "justify-center" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <span className={active ? "text-[var(--accent)]" : "text-[var(--text-3)]"}>
        <RailIcon name={icon} />
      </span>
      {collapsed ? null : <span className="truncate font-medium">{label}</span>}
    </Link>
  );
}

function RailGroupLabel({ children, collapsed, first }: { children: ReactNode; collapsed: boolean; first?: boolean }) {
  if (collapsed) {
    return <div className={`${first ? "mt-1" : "mt-2"} mx-auto h-px w-6 shrink-0 bg-divider`} />;
  }
  return (
    <p className="shrink-0 px-2 pt-4 pb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-[var(--text-3)]">
      {children}
    </p>
  );
}

export function AppRail({ workspaceName, visibleModes }: Props) {
  const pathname = usePathname();
  const { productName, logoSrc } = useProductBrand();
  const [collapsed, setCollapsed] = useState(false);
  const [railWidth, setRailWidth] = usePanelWidth(RAIL_WIDTH_KEY, RAIL_WIDTH.default, RAIL_WIDTH.min, RAIL_WIDTH.max);
  const modes = PRODUCT_MODES.filter((mode) => visibleModes.includes(mode.id));
  const homeHref = firstVisibleHref(visibleModes);
  const chatMode = modes.find((mode) => mode.id === "chat");
  const jobModes = modes.filter((mode) => mode.id !== "chat");
  const marketSpecialists = useRailMarketSpecialists();
  const financeTasks = useRailFinanceTasks();

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

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)]"
      style={{ width: collapsed ? RAIL_WIDTH.collapsed : railWidth }}
      aria-label={t("rail.aria")}
      data-rail={collapsed ? "min" : "full"}
    >
      <div
        className={`flex h-12 shrink-0 ${collapsed ? "items-center justify-center px-1.5" : "items-center gap-2 px-3"}`}
      >
        {collapsed ? (
          <WorkspaceSwitcher workspaceName={workspaceName} compact logoSrc={logoSrc} />
        ) : (
          <>
            {logoSrc ? (
              <img src={logoSrc} alt="" className="h-5 w-5 shrink-0 object-contain" data-testid="product-logo" />
            ) : (
              <span
                className="grid h-5 w-5 shrink-0 place-items-center text-xs font-medium text-[var(--text)]"
                data-testid="product-logo"
              >
                {productMonogram(productName)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={homeHref}
                className="block truncate text-sm font-medium tracking-[var(--track)] text-[var(--text)]"
                data-testid="product-brand"
              >
                {productName}
              </Link>
              <WorkspaceSwitcher workspaceName={workspaceName} />
            </div>
          </>
        )}
      </div>

      {/* `mr-2`: a scrollbar is laid out inside the border box and outside the
          padding box, so padding cannot move it — only the margin can. Pulling
          the scrolling box 8px off the aside's right edge clears the lane the
          `rail-resize` strip occupies, so the handle is never stacked on top of
          this nav's scrollbar (owner report 2026-09-17). */}
      <nav className="mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" aria-label={t("rail.modesAria")}>
        {chatMode ? (
          <>
            <RailGroupLabel collapsed={collapsed} first>
              {t("rail.groupConverse")}
            </RailGroupLabel>
            <RailItem
              href={chatMode.href}
              label={t("rail.chat")}
              icon="chat"
              active={productModeMatches(chatMode.id, pathname)}
              collapsed={collapsed}
              testId={`mode-${chatMode.href.slice(1)}`}
            />
            {/* Collapsed rail stays a pure icon column: no session rows, no new-chat row. */}
            {collapsed ? null : <RailRecentThreads />}
          </>
        ) : null}

        {jobModes.length > 0 ? <RailGroupLabel collapsed={collapsed}>{t("rail.groupJobs")}</RailGroupLabel> : null}
        {jobModes.map((mode) => {
          const item = (
            <RailItem
              key={mode.href}
              href={mode.href}
              label={t(`rail.${mode.id}`)}
              icon={(mode.id in RAIL_ICON_PATHS ? mode.id : "documents") as IconName}
              active={productModeMatches(mode.id, pathname)}
              collapsed={collapsed}
              testId={`mode-${mode.href.slice(1)}`}
            />
          );
          /*
           * Market carries its agents the way Chat carries its sessions: the
           * chevron rides on the Market row and the desks render under it, each
           * one its own harness and its own watchlist. The collapsed rail stays
           * a pure icon column, so neither the chevron nor the rows appear there.
           */
          if (collapsed || (mode.id !== "market" && mode.id !== "finance")) {
            return item;
          }
          if (mode.id === "finance") {
            /* Finance carries its tasks on exactly the Market rules: same row,
               same chevron, same one `h-8`, same nothing-below-when-closed. */
            return (
              <div key={mode.href} className="shrink-0" data-testid="rail-finance-mode">
                <div className="flex h-8 items-center gap-0.5">
                  <div className="min-w-0 flex-1">{item}</div>
                  <RailFinanceTasksToggle
                    open={financeTasks.open}
                    onToggle={financeTasks.toggle}
                    enabled={financeTasks.enabled}
                  />
                </div>
                {financeTasks.open ? <RailFinanceTasks /> : null}
              </div>
            );
          }
          return (
            <div key={mode.href} className="shrink-0" data-testid="rail-market-mode">
              {/* Exactly one `h-8` row, like any other job mode: the chevron rides
                  inside it, and when the list is closed nothing renders below. */}
              <div className="flex h-8 items-center gap-0.5">
                <div className="min-w-0 flex-1">{item}</div>
                <RailMarketSpecialistsToggle
                  open={marketSpecialists.open}
                  onToggle={marketSpecialists.toggle}
                  enabled={marketSpecialists.enabled}
                />
              </div>
              {marketSpecialists.open ? <RailMarketSpecialists /> : null}
            </div>
          );
        })}

        <RailGroupLabel collapsed={collapsed}>{t("rail.groupAccount")}</RailGroupLabel>
        <RailItem
          href="/knowledge"
          label={t("rail.knowledge")}
          icon="knowledge"
          active={pathname.startsWith("/knowledge")}
          collapsed={collapsed}
          testId="mode-knowledge"
        />
        <RailItem
          href="/channels"
          label={t("rail.channels")}
          icon="channels"
          active={pathname.startsWith("/channels")}
          collapsed={collapsed}
          testId="channels-link"
        />
        <RailItem
          href="/workspaces"
          label={t("rail.workspaces")}
          icon="workspaces"
          active={pathname.startsWith("/workspaces")}
          collapsed={collapsed}
          testId="workspaces-link"
        />
        <RailItem
          href="/usage"
          label={t("rail.usage")}
          icon="usage"
          active={pathname.startsWith("/usage")}
          collapsed={collapsed}
          testId="usage-link"
        />
        <RailItem
          href="/settings"
          label={t("rail.settings")}
          icon="settings"
          active={pathname.startsWith("/settings")}
          collapsed={collapsed}
          testId="settings-link"
        />
      </nav>

      <div
        className={`flex shrink-0 items-center border-t border-[var(--line)] p-2 ${collapsed ? "flex-col gap-2" : "justify-between gap-2"}`}
        data-testid="rail-footer"
      >
        <ThemeToggle />
        <div className={`flex items-center gap-2 ${collapsed ? "flex-col" : "min-w-0 flex-1 justify-end"}`}>
          <AppUpdatesButton collapsed={collapsed} />
          <button
            type="button"
            className="btn btn-ghost btn-icon h-8 w-8 shrink-0 wash"
            onClick={toggleCollapsed}
            data-testid={collapsed ? "rail-expand" : "rail-collapse"}
            aria-label={collapsed ? t("rail.expand") : t("rail.collapse")}
            title={collapsed ? t("rail.expand") : t("rail.collapse")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <PanelResizeHandle
          width={railWidth}
          min={RAIL_WIDTH.min}
          max={RAIL_WIDTH.max}
          onWidth={setRailWidth}
          label={t("rail.resize")}
          testId="rail-resize"
        />
      )}
    </aside>
  );
}
