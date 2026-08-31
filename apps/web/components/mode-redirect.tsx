"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { redirectIfHiddenMode, type ProductMode } from "@agentforge/core/product-modes";

export function ModeRedirect({ visibleModes }: { visibleModes: ProductMode[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const target = redirectIfHiddenMode(pathname, visibleModes);

  useEffect(() => {
    if (target) {
      router.replace(target);
    }
  }, [target, router]);

  return null;
}
