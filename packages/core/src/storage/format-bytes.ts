/**
 * Human bytes for a screen, a log line or an error detail. Never used for arithmetic.
 *
 * Kept in its own module with no imports so the renderer can take it through
 * `@agentforge/core/format-bytes` without pulling in `quota.ts`, whose server-mode rules read
 * `process.env` and do not belong in the browser.
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
