import type { ReactNode } from "react";
import type { ProductMode } from "@agentforge/core/product-modes";
import { AppRail } from "@/components/app-rail";
import { ModeRedirect } from "@/components/mode-redirect";
import { usePathname } from "@/lib/nav";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
  children: ReactNode;
};

export function productMonogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "A";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return trimmed.slice(0, 1).toUpperCase();
}

export function AppShell({ workspaceName, visibleModes, children }: Props) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen bg-app text-inkbase">
      <ModeRedirect visibleModes={visibleModes} />
      <AppRail workspaceName={workspaceName} visibleModes={visibleModes} />
      <div className="desk-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="app-main-panel">
        {/* Keyed on the route so each page plays its entrance; query changes (a chat thread, a
            finance task) keep the same key and do not remount. */}
        <div key={pathname} className="page-enter min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
