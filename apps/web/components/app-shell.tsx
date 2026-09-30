import type { ReactNode } from "react";
import type { ProductMode } from "@agentforge/core/product-modes";
import { AppRail } from "@/components/app-rail";
import { ModeRedirect } from "@/components/mode-redirect";
import { modeRedirectAllowed, type ShellModesSource } from "@/lib/shell-modes";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
  /** Where `visibleModes` came from (`lib/shell-modes.ts`); the host's answer is the default. */
  modesSource?: ShellModesSource;
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

export function AppShell({ workspaceName, visibleModes, modesSource = "host", children }: Props) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-app text-inkbase">
      {/* A remembered or unknown list is only good for the first frame: nobody is redirected on it. */}
      <ModeRedirect visibleModes={visibleModes} settled={modeRedirectAllowed(modesSource)} />
      <AppRail workspaceName={workspaceName} visibleModes={visibleModes} modesSource={modesSource} />
      <div className="desk-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="app-main-panel">
        {/* Not a scroller, and not keyed on the route. Each desk page owns one
            scrollport (`DeskPane`). Keying this slot remounted every page on
            navigation, which dropped scroll position and the kept-alive modes. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
