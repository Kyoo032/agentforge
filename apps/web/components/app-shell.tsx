import type { ReactNode } from "react";
import type { ProductMode } from "@agentforge/core/product-modes";
import { AppRail } from "@/components/app-rail";
import { ModeRedirect } from "@/components/mode-redirect";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
  children: ReactNode;
};

export function AppShell({ workspaceName, visibleModes, children }: Props) {
  return (
    <div className="flex h-screen gap-2 bg-mist p-2">
      <ModeRedirect visibleModes={visibleModes} />
      <AppRail workspaceName={workspaceName} visibleModes={visibleModes} />
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-paper"
        data-testid="app-main-panel"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
