"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { applyTheme, getStoredTheme, resolveTheme, setStoredTheme, type Theme } from "@/lib/theme";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "dark") {
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
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M3 12h1.5M19.5 12H21M4.9 19.1 6 18M18 6l1.1-1.1" />
      </svg>
    );
  }
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
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />
    </svg>
  );
}

/* The label is `aria-label`/`title` only (owner ruling 2026-09-23): the footer is
   an icon row, so the word never renders. It stays here because it is also the
   accessible name. One 32px square in both rail states, so the row stays aligned. */
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

  const label = theme === "dark" ? t("common.theme.light") : t("common.theme.dark");

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? "btn btn-ghost btn-icon h-8 w-8 shrink-0 rounded-md wash text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]"}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}
