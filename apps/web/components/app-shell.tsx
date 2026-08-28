"use client";

import type { ReactNode } from "react";
import { AppRail } from "@/components/app-rail";

type Props = {
  workspaceName: string;
  children: ReactNode;
};

export function AppShell({ workspaceName, children }: Props) {
  return (
    <div className="flex h-screen gap-2 bg-mist p-2">
      <AppRail workspaceName={workspaceName} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
