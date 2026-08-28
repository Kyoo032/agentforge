export const RAIL_COLLAPSED_KEY = "agentforge-rail-collapsed";

export function getRailCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
}

export function setRailCollapsed(collapsed: boolean) {
  window.localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
}
