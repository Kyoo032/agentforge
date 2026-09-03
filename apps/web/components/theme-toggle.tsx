"use client";

import { useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  type Theme,
} from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    const next = resolveTheme(getStoredTheme());
    setTheme(next);
    applyTheme(next);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setStoredTheme(next);
  }

  const label = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? "block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-mist"}
      aria-label={label}
    >
      {label}
    </button>
  );
}
