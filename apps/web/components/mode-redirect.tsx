"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "@/lib/nav";
import { redirectIfHiddenMode, type ProductMode } from "@agentforge/core/product-modes";

/**
 * `settled` is false while `visibleModes` is a remembered or unknown list (`lib/shell-modes.ts`), and
 * then nothing redirects: only the host's answer may send someone away from a mode.
 */
export function ModeRedirect({ visibleModes, settled = true }: { visibleModes: ProductMode[]; settled?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const target = settled ? redirectIfHiddenMode(pathname, visibleModes) : null;

  useEffect(() => {
    if (target) {
      router.replace(target);
    }
  }, [target, router]);

  return null;
}
