"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { redirectIfHiddenMode, type ProductMode } from "@agentforge/core/product-modes";
import { AppRail } from "@/components/app-rail";

type Props = {
  workspaceName: string;
  visibleModes: ProductMode[];
  children: ReactNode;
};

export function AppShell({ workspaceName, visibleModes, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const target = redirectIfHiddenMode(pathname, visibleModes);

  useEffect(() => {
    if (target) {
      router.replace(target);
    }
  }, [target, router]);

  return (
    <div className="flex h-screen gap-2 bg-mist p-2">
      <AppRail workspaceName={workspaceName} visibleModes={visibleModes} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
