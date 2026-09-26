/** How far from the end still counts as "following the reply". */
export const PIN_SLACK_PX = 64;

/**
 * True when the reader is at the end of a scrolling pane, within `slack`.
 * A streaming reply follows only while this is true, so scrolling up to read
 * stays where they left it.
 */
export function isPinnedToEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack = PIN_SLACK_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
