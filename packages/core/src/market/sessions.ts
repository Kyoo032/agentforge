/**
 * Exchange clocks for the watchlist.
 *
 * `market-clock.ts` answers one question — is the U.S. market open — because
 * that is all a U.S. pre-market briefing needed. A watchlist that mixes IDX
 * names, Tokyo names and a coin needs the same answer per venue, so this
 * module generalises it: one schedule per exchange, the same `Intl`-driven
 * wall clock (so DST is the zone database's problem, not ours), and the next
 * instant at which the state changes.
 *
 * Pure and deterministic. Holidays are not modelled: a closed holiday reads as
 * "open" here, which is why the rendered line is context, never a claim that a
 * price is live.
 */
import { zonedTime, type ZonedTime } from "./market-clock";
import { MARKET_EXCHANGES, type MarketExchange, type MarketSession, type SessionState } from "./watch-schemas";

const HOUR = 60;
const DAY_MS = 86_400_000;
/** How far ahead to look for the next state change before giving up. A week plus a day covers any weekend. */
export const NEXT_CHANGE_HORIZON_DAYS = 8;

const at = (hours: number, minutes = 0): number => hours * HOUR + minutes;

/** A schedule segment: from this many minutes past local midnight, the exchange is in this state. */
type Segment = { readonly from: number; readonly state: SessionState };

type Schedule = {
  readonly timeZone: string;
  /** Ordered by `from`, starting at 0. A weekend day is closed whatever these say. */
  readonly segments: readonly Segment[];
};

const CLOSED_AT_MIDNIGHT: Segment = { from: 0, state: "closed" };

/**
 * Regular hours per venue, local time, Monday to Friday.
 * IDX runs two sessions with a lunch break between them; the U.S. venues carry
 * the pre and post windows `market-clock.ts` already uses.
 */
const SCHEDULES: Readonly<Record<Exclude<MarketExchange, "CRYPTO">, Schedule>> = {
  IDX: {
    timeZone: "Asia/Jakarta",
    segments: [
      CLOSED_AT_MIDNIGHT,
      { from: at(9), state: "open" },
      { from: at(12), state: "closed" },
      { from: at(13, 30), state: "open" },
      { from: at(15, 50), state: "closed" },
    ],
  },
  NYSE: {
    timeZone: "America/New_York",
    segments: [
      CLOSED_AT_MIDNIGHT,
      { from: at(4), state: "pre" },
      { from: at(9, 30), state: "open" },
      { from: at(16), state: "post" },
      { from: at(20), state: "closed" },
    ],
  },
  LSE: {
    timeZone: "Europe/London",
    segments: [CLOSED_AT_MIDNIGHT, { from: at(8), state: "open" }, { from: at(16, 30), state: "closed" }],
  },
  TSE: {
    timeZone: "Asia/Tokyo",
    segments: [CLOSED_AT_MIDNIGHT, { from: at(9), state: "open" }, { from: at(15), state: "closed" }],
  },
  HKEX: {
    timeZone: "Asia/Hong_Kong",
    segments: [CLOSED_AT_MIDNIGHT, { from: at(9, 30), state: "open" }, { from: at(16), state: "closed" }],
  },
  SGX: {
    timeZone: "Asia/Singapore",
    segments: [CLOSED_AT_MIDNIGHT, { from: at(9), state: "open" }, { from: at(17), state: "closed" }],
  },
};

/** Yahoo venue suffix -> exchange. Checked after the explicit index and crypto cases. */
const EXCHANGE_BY_SUFFIX: Readonly<Record<string, MarketExchange>> = {
  JK: "IDX",
  L: "LSE",
  T: "TSE",
  HK: "HKEX",
  SI: "SGX",
};

/** Indices that belong to a non-U.S. venue. Every other `^` index is read on the U.S. clock. */
const EXCHANGE_BY_INDEX: Readonly<Record<string, MarketExchange>> = {
  "^JKSE": "IDX",
  "^FTSE": "LSE",
  "^N225": "TSE",
  "^HSI": "HKEX",
  "^STI": "SGX",
};

const CRYPTO_SUFFIX = "-USD";
const SATURDAY = 6;
const SUNDAY = 0;

type CalendarDate = { year: number; month: number; day: number };

/**
 * The exchange whose clock a ticker trades on. Futures (`=F`), FX (`=X`) and
 * unsuffixed U.S. names all read on the New York clock, which is the venue
 * whose hours actually move them.
 */
export function exchangeForTicker(ticker: string): MarketExchange {
  const symbol = ticker.trim().toUpperCase();
  if (symbol.endsWith(CRYPTO_SUFFIX)) {
    return "CRYPTO";
  }
  if (symbol.startsWith("^")) {
    return EXCHANGE_BY_INDEX[symbol] ?? "NYSE";
  }
  const dot = symbol.lastIndexOf(".");
  const suffix = dot === -1 ? "" : symbol.slice(dot + 1);
  return EXCHANGE_BY_SUFFIX[suffix] ?? "NYSE";
}

function isWeekend(date: CalendarDate): boolean {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === SATURDAY || weekday === SUNDAY;
}

function stateAt(schedule: Schedule, date: CalendarDate, minutes: number): SessionState {
  if (isWeekend(date)) {
    return "closed";
  }
  return schedule.segments.reduce<SessionState>(
    (state, segment) => (minutes >= segment.from ? segment.state : state),
    "closed",
  );
}

/** Offset of `timeZone` from UTC at a given instant, in milliseconds (positive east of Greenwich). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const zoned = zonedTime(new Date(instantMs), timeZone);
  return Date.UTC(zoned.year, zoned.month - 1, zoned.day, 0, zoned.minutes) - instantMs;
}

/**
 * The UTC instant of a local wall-clock time. Two passes: guess with the
 * offset at the naive instant, then correct with the offset actually in force
 * there, which settles any DST step.
 */
function instantFromLocal(timeZone: string, date: CalendarDate, minutes: number): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(guess, timeZone);
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

type Boundary = { instantMs: number; state: SessionState };

/** Every segment boundary in the look-ahead horizon, as instants, oldest first. */
function boundaries(schedule: Schedule, from: CalendarDate): Boundary[] {
  const rows = Array.from({ length: NEXT_CHANGE_HORIZON_DAYS }, (_, offset) => addDays(from, offset)).flatMap((date) =>
    schedule.segments.map((segment) => ({
      instantMs: instantFromLocal(schedule.timeZone, date, segment.from),
      state: stateAt(schedule, date, segment.from),
    })),
  );
  return [...rows].sort((left, right) => left.instantMs - right.instantMs);
}

/** The first instant after `now` at which the state differs, or null when the horizon holds none. */
function nextChange(schedule: Schedule, now: Date, current: SessionState, today: ZonedTime): string | null {
  const nowMs = now.getTime();
  const found = boundaries(schedule, today).find(
    (boundary) => boundary.instantMs > nowMs && boundary.state !== current,
  );
  return found === undefined ? null : new Date(found.instantMs).toISOString();
}

const ALWAYS_OPEN: Omit<MarketSession, "exchange"> = { state: "always", nextChangeAt: null };

/** The session row for one exchange at the instant `now`. */
export function sessionFor(now: Date, exchange: MarketExchange): MarketSession {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("sessionFor: now is not a valid date");
  }
  if (exchange === "CRYPTO") {
    return { exchange, ...ALWAYS_OPEN };
  }
  const schedule = SCHEDULES[exchange];
  const today = zonedTime(now, schedule.timeZone);
  const state = stateAt(schedule, today, today.minutes);
  return { exchange, state, nextChangeAt: nextChange(schedule, now, state, today) };
}

/**
 * One row per exchange the watchlist touches, deduped and in the canonical
 * `MARKET_EXCHANGES` order so two runs of the same watchlist read the same.
 */
export function computeSessions(now: Date, tickers: readonly string[]): MarketSession[] {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("computeSessions: now is not a valid date");
  }
  const wanted: ReadonlySet<MarketExchange> = new Set(tickers.map(exchangeForTicker));
  return MARKET_EXCHANGES.filter((exchange) => wanted.has(exchange)).map((exchange) => sessionFor(now, exchange));
}
