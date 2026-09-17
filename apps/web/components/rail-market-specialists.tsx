"use client";

import { useSearchParams, usePathname } from "@/lib/nav";
import { getLocale, t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { RailSubmenu, RailSubmenuToggle, useRailSubmenu, type RailSubmenuRow } from "@/components/rail-submenu";
import {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALISTS,
  isMarketSpecialist,
  specialistHint,
  specialistLabel,
  type MarketSpecialist,
} from "@/lib/market-specialist";

export const MARKET_PATH = "/market";

/** The agent the URL names, with the default behind an absent or unknown value. */
export function specialistFromParam(value: string | null | undefined): MarketSpecialist {
  return isMarketSpecialist(value) ? value : DEFAULT_MARKET_SPECIALIST;
}

/** `/market?specialist=<id>` — the one place the rail links a desk. */
export function specialistHref(id: MarketSpecialist): string {
  return `${MARKET_PATH}?specialist=${encodeURIComponent(id)}`;
}

/** Open exactly while the user is on Market; see `useRailSubmenu` for the rule. */
export function useRailMarketSpecialists(): { open: boolean; toggle: () => void; enabled: boolean } {
  return useRailSubmenu(MARKET_PATH);
}

/** The chevron on the Market row. Shows and hides only; it never navigates. */
export function RailMarketSpecialistsToggle({
  open,
  onToggle,
  enabled = true,
}: {
  open: boolean;
  onToggle: () => void;
  enabled?: boolean;
}) {
  return (
    <RailSubmenuToggle
      open={open}
      onToggle={onToggle}
      enabled={enabled}
      label={open ? t("rail.marketSpecialistsHide") : t("rail.marketSpecialistsToggle")}
      testId="rail-market-specialists-toggle"
    />
  );
}

/**
 * The Market agents, parked under the Market rail entry the way the chat
 * sessions sit under Chat (owner decision 2026-09-17). Each agent has its own
 * harness and its own watchlist, so the row is the way into a desk: the studio
 * reads `?specialist=` back off the URL rather than offering a second picker.
 */
export function RailMarketSpecialists() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = getLocale();
  const rows: RailSubmenuRow[] = MARKET_SPECIALISTS.map((id) => ({
    id,
    href: specialistHref(id),
    label: labeled(`market.specialists.${id}.label`, specialistLabel(id, locale)),
    hint: labeled(`market.specialists.${id}.hint`, specialistHint(id, locale)),
  }));

  return (
    <RailSubmenu
      rows={rows}
      currentId={specialistFromParam(searchParams.get("specialist"))}
      onMode={pathname === MARKET_PATH}
      ariaLabel={t("rail.marketSpecialistsAria")}
      testId="rail-market-specialists"
      branchTestId="rail-market-specialists-branch"
      rowTestId={(id) => `rail-market-specialist-${id}`}
    />
  );
}
