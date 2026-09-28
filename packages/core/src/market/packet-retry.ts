/**
 * One extra gather when a source the desk asked for did not answer.
 *
 * An unknown name is not retried: the venue already said it is not a ticker,
 * and a second fetch will not invent it. A tie keeps the first packet so a
 * flaky second pass cannot replace a reading we already have.
 */
import type { MarketWatchPacket } from "./watch-schemas";

/**
 * A source that did not answer: reset, timeout, or an HTTP status worth one
 * more try. An empty headline list is an answer. An unknown symbol is not a
 * source that will appear on a second fetch.
 */
const QUIET_SOURCE =
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|timed out|socket|fetch failed|network|HTTP 429|HTTP 5\d\d|unavailable)\b/i;

export type PacketAttempt = {
  packet: MarketWatchPacket;
  /** Packet-wide failures (unresolved names, macro). Per-ticker holes sit on each ticker. */
  failures: readonly string[];
};

/** True when the note is a source that stayed quiet, not an empty answer or an unknown symbol. */
export function isQuietSourceFailure(message: string): boolean {
  return QUIET_SOURCE.test(message);
}

/** How many quiet-source holes this attempt still has. Unknown symbols do not count. */
export function quietSourceGapCount(attempt: PacketAttempt): number {
  const packetWide = attempt.failures.filter(isQuietSourceFailure).length;
  const perTicker = attempt.packet.tickers.reduce(
    (sum, ticker) => sum + ticker.failures.filter(isQuietSourceFailure).length,
    0,
  );
  return packetWide + perTicker;
}

/** Whether the gather should be run once more. */
export function needsSourceRetry(attempt: PacketAttempt): boolean {
  return quietSourceGapCount(attempt) > 0;
}

/**
 * Keep the attempt that left fewer quiet-source holes.
 * A second pass that resolves tickers the first pass could not is kept even
 * when both still have holes. A tie keeps the first attempt.
 */
export function chooseRetriedPacket(first: PacketAttempt, second: PacketAttempt): PacketAttempt {
  if (first.packet.tickers.length === 0 && second.packet.tickers.length > 0) {
    return second;
  }
  return quietSourceGapCount(second) < quietSourceGapCount(first) ? second : first;
}
