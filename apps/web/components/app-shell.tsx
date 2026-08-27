"use client";

import type { ReactNode } from "react";
import { AppRail, type RailAgent } from "@/components/app-rail";

type Props = {
  workspaceName: string;
  agents: RailAgent[];
  children: ReactNode;
};

export function AppShell({ workspaceName, agents, children }: Props) {
  return (
    <div className="flex h-screen gap-3 bg-mist p-3">
      <AppRail workspaceName={workspaceName} agents={agents} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl bg-paper">{children}</div>
    </div>
  );
}
