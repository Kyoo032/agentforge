export const RAIL_WIDTH_KEY = "agentforge-rail-width";

export const RAIL_WIDTH = { default: 232, min: 168, max: 360, collapsed: 68 } as const;

export function clampPanelWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function readPanelWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return clampPanelWidth(Number(raw), min, max);
}

export function writePanelWidth(key: string, value: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
}
