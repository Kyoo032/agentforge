/**
 * U.S. session clock in America/New_York, so a late run cannot pose as a
 * pre-market briefing. Weekday sessions: 04:00-09:30 pre, 09:30-16:00 regular,
 * 16:00-20:00 post, otherwise closed. The note is written for the reader in
 * WIB and ET.
 */
import type { MarketClock } from "./watch-schemas";

export const US_MARKET_TIMEZONE = "America/New_York";
export const WIB_TIMEZONE = "Asia/Jakarta";

const PRE_OPEN_MINUTES = 4 * 60;
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const POST_CLOSE_MINUTES = 20 * 60;
const HOURS_PER_DAY = 24;

const WEEKEND_DAYS: ReadonlySet<string> = new Set(["Sat", "Sun"]);

export const WEEKEND_NOTE = "Weekend: prices are last close, not pre-market.";

const SESSION_NOTES: Readonly<Record<MarketClock["usSession"], string>> = {
  pre: "U.S. pre-market.",
  regular: "U.S. regular session is open; quotes are live intraday.",
  post: "U.S. after-hours; prices are the close plus post-market moves.",
  closed: "U.S. market closed (overnight); prices are last close, not pre-market.",
};

type ZonedTime = { weekday: string; minutes: number; hhmm: string };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function zonedTime(now: Date, timeZone: string): ZonedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour")) % HOURS_PER_DAY;
  const minute = Number(part("minute"));
  return { weekday: part("weekday"), minutes: hour * 60 + minute, hhmm: `${pad2(hour)}:${pad2(minute)}` };
}

function sessionAt(minutes: number): MarketClock["usSession"] {
  if (minutes >= PRE_OPEN_MINUTES && minutes < REGULAR_OPEN_MINUTES) {
    return "pre";
  }
  if (minutes >= REGULAR_OPEN_MINUTES && minutes < REGULAR_CLOSE_MINUTES) {
    return "regular";
  }
  if (minutes >= REGULAR_CLOSE_MINUTES && minutes < POST_CLOSE_MINUTES) {
    return "post";
  }
  return "closed";
}

/** Session and reader note for the instant `now`. Throws on an invalid date (fail loud). */
export function marketClock(now: Date): MarketClock {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("marketClock: now is not a valid date");
  }
  const runAt = now.toISOString();
  const et = zonedTime(now, US_MARKET_TIMEZONE);
  if (WEEKEND_DAYS.has(et.weekday)) {
    return { runAt, usSession: "closed", note: WEEKEND_NOTE };
  }
  const wib = zonedTime(now, WIB_TIMEZONE);
  const usSession = sessionAt(et.minutes);
  return { runAt, usSession, note: `Run at ${wib.hhmm} WIB = ${et.hhmm} ET, ${SESSION_NOTES[usSession]}` };
}
