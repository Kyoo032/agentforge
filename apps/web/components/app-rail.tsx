"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@/lib/nav";
import { usePathname } from "@/lib/nav";
import { PRODUCT_MODES, firstVisibleHref, productModeMatches, type ProductMode } from "@agentforge/core/product-modes";
import { AppUpdatesButton } from "@/components/app-updates";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { getRailCollapsed, setRailCollapsed } from "@/lib/rail-prefs";
import { useProductBrand } from "@/lib/product-brand";
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
  | "edit"
  | "presentations"
  | "knowledge"
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
      className={`flex h-8 items-center gap-2 rounded-lg px-2 text-sm tracking-[var(--track)] ${
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
    return <div className={`${first ? "mt-1" : "mt-2"} mx-auto h-px w-6 bg-divider`} />;
  }
  return (
    <p className="px-2 pt-4 pb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-[var(--text-3)]">{children}</p>
  );
}

export function AppRail({ workspaceName, visibleModes }: Props) {
  const pathname = usePathname();
  const { productName, logoSrc } = useProductBrand();
  const [collapsed, setCollapsed] = useState(false);
  const modes = PRODUCT_MODES.filter((mode) => visibleModes.includes(mode.id));
  const homeHref = firstVisibleHref(visibleModes);
  const chatMode = modes.find((mode) => mode.id === "chat");
  const jobModes = modes.filter((mode) => mode.id !== "chat");

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
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)]"
      style={{ width: collapsed ? 68 : "var(--sidebar)" }}
      aria-label="Product modes"
      data-rail={collapsed ? "min" : "full"}
    >
      <div
        className={`flex h-12 shrink-0 ${
          collapsed ? "items-center justify-center px-1.5" : "items-center gap-2 px-3"
        }`}
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

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" aria-label="Modes">
        {chatMode ? (
          <>
            <RailGroupLabel collapsed={collapsed} first>
              Converse
            </RailGroupLabel>
            <RailItem
              href={chatMode.href}
              label={chatMode.label}
              icon="chat"
              active={productModeMatches(chatMode.id, pathname)}
              collapsed={collapsed}
              testId={`mode-${chatMode.href.slice(1)}`}
            />
          </>
        ) : null}

        {jobModes.length > 0 ? <RailGroupLabel collapsed={collapsed}>Job modes</RailGroupLabel> : null}
        {jobModes.map((mode) => (
          <RailItem
            key={mode.href}
            href={mode.href}
            label={mode.label}
            icon={(mode.id in RAIL_ICON_PATHS ? mode.id : "documents") as IconName}
            active={productModeMatches(mode.id, pathname)}
            collapsed={collapsed}
            testId={`mode-${mode.href.slice(1)}`}
          />
        ))}

        <RailGroupLabel collapsed={collapsed}>Account</RailGroupLabel>
        <RailItem
          href="/knowledge"
          label="Knowledge Base"
          icon="knowledge"
          active={pathname.startsWith("/knowledge")}
          collapsed={collapsed}
          testId="mode-knowledge"
        />
        <RailItem
          href="/workspaces"
          label="Workspaces"
          icon="workspaces"
          active={pathname.startsWith("/workspaces")}
          collapsed={collapsed}
          testId="workspaces-link"
        />
        <RailItem
          href="/usage"
          label="Usage"
          icon="usage"
          active={pathname.startsWith("/usage")}
          collapsed={collapsed}
          testId="usage-link"
        />
        <RailItem
          href="/settings"
          label="Settings"
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
        <div className={`flex items-center gap-2 ${collapsed ? "flex-col" : ""}`}>
          <AppUpdatesButton />
          <button
            type="button"
            className="btn btn-ghost btn-icon h-8 w-8 shrink-0 wash"
            onClick={toggleCollapsed}
            data-testid={collapsed ? "rail-expand" : "rail-collapse"}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
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
    </aside>
  );
}
