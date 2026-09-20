/**
 * The host's one logger — structured, redacted, level-gated.
 *
 * Every line is a single JSON object on one stream: `{ts, level, event, ...fields}`. One line per
 * call, so a hosted deployment can ship stdout/stderr straight into a log store and a newline in a
 * value can never forge a second entry.
 *
 * PRIVACY (docs/internal/web-security-spec.md, L1) — a log line is the easiest place to leak a
 * tenant's work. Two rules, both enforced here rather than at the call site:
 *   1. Every string that goes out passes through `redactSecrets`, recursively, depth-limited.
 *   2. A field whose name is a tenant-content name (`prompt`, `body`, `match`, ...) or merely
 *      contains a credential word (`apiKey`, `accessToken`, `sessionId`, ...) is never written; its
 *      value is replaced by `DROPPED_MARKER` so the shape of the line still shows it was there.
 * The call site can still be careless; the logger stays the floor.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { redactSecrets } from "@agentforge/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

/** Written in place of a value whose field name may never reach a log. */
export const DROPPED_MARKER = "[dropped]";

/** Written in place of a value nested deeper than `MAX_DEPTH`. */
export const DEPTH_MARKER = "[depth]";

/** Written in place of a value that refers back to one of its own parents. */
export const CYCLE_MARKER = "[cycle]";

export const LOG_LEVEL_ENV = "AGENTFORGE_LOG_LEVEL";

const DEFAULT_LEVEL: LogLevel = "info";

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Credential words. A field whose name *contains* one of these, anywhere, in any case, is dropped:
 * `apiKey`, `accessToken`, `refreshToken`, `sessionId` and every other shape a call site invents are
 * all the same secret, and an exact-name list only ever catches the one spelling someone thought of.
 *
 * The cost is the occasional innocent field — `keyCount`, `monkeys` — and that is the deliberate
 * trade: the call site gets renamed (see `market-briefing-build.ts`), the rule does not get looser.
 */
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "token",
  "secret",
  "key",
  "password",
  "passwd",
  "cookie",
  "authorization",
  "csrf",
  "session",
];

/**
 * Names that carry a tenant's own words. Matched exactly, because these are ordinary English and a
 * substring rule would eat `matchCount`, `contentBytes` and `outputPath` for no gain: the risk here
 * is the value itself being the tenant's text, not a family of names hiding a credential.
 * Kept in step with the security spec — do not widen without updating it.
 */
const FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "prompt",
  "messages",
  "body",
  "content",
  "input",
  "output",
  "text",
  "match",
  "snippet",
  "sql",
]);

/** True when this field name may never reach a log, by either rule. */
function isForbiddenField(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_FIELDS.has(lower) || FORBIDDEN_SUBSTRINGS.some((word) => lower.includes(word));
}

/** Deep enough for an error envelope, shallow enough that a rogue graph cannot stall a request. */
const MAX_DEPTH = 4;

/** Caps one array so a 10k-row payload cannot become a 10k-entry log line. */
const MAX_ARRAY = 32;

export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that stamps `fields` (a tenant id, a request id) onto every line it writes. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  /** Defaults to `process.env`. Passed explicitly by tests so no suite has to mutate the real one. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Defaults to the console sink below. */
  readonly sink?: LogSink;
  /** Stamped onto every line; see `child`. */
  readonly fields?: LogFields;
}

/**
 * stdout for debug/info, stderr for warn/error — through `console` rather than `process.stdout`
 * because the desktop main process captures console output into its own log, and losing that
 * capture would be a behaviour change.
 */
const consoleSink: LogSink = (level, line) => {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.info(line);
};

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_RANK;
}

function resolveLevel(env: Readonly<Record<string, string | undefined>>): LogLevel {
  const raw = env[LOG_LEVEL_ENV]?.trim().toLowerCase();
  return raw && isLogLevel(raw) ? raw : DEFAULT_LEVEL;
}

function describeError(error: Error): string {
  return error.message ? `${error.name}: ${error.message}` : error.name;
}

/** One value, made safe: secrets redacted, forbidden names dropped, depth and width capped. */
function sanitiseValue(value: unknown, depth: number, seen: ReadonlySet<object>): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Error) {
    return redactSecrets(describeError(value));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_DEPTH) {
    return DEPTH_MARKER;
  }
  if (seen.has(value as object)) {
    return CYCLE_MARKER;
  }
  const nested = new Set(seen).add(value as object);
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY).map((item) => sanitiseValue(item, depth + 1, nested));
    return value.length > MAX_ARRAY ? [...kept, `[+${value.length - MAX_ARRAY} more]`] : kept;
  }
  if (isPlainRecord(value)) {
    return sanitiseFields(value, depth + 1, nested);
  }
  return redactSecrets(String(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitiseFields(
  fields: Readonly<Record<string, unknown>>,
  depth: number,
  seen: ReadonlySet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (isForbiddenField(name)) {
      out[name] = DROPPED_MARKER;
      continue;
    }
    const safe = sanitiseValue(value, depth, seen);
    if (safe !== undefined) {
      out[name] = safe;
    }
  }
  return out;
}

function lineFor(level: LogLevel, event: string, fields: Readonly<Record<string, unknown>>): string {
  const safe = sanitiseFields(fields, 0, new Set<object>());
  const record = { ts: new Date().toISOString(), level, event: redactSecrets(event), ...safe };
  try {
    return JSON.stringify(record);
  } catch {
    // A value whose own toJSON throws must still leave a trace of the event.
    return JSON.stringify({ ts: record.ts, level, event: record.event, fields: "[unserialisable]" });
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const env = options.env ?? process.env;
  const sink = options.sink ?? consoleSink;
  const base = options.fields ?? {};
  const threshold = LEVEL_RANK[resolveLevel(env)];

  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < threshold) {
      return;
    }
    // Widest scope first: the ambient request context (below), then the logger's own bound fields
    // from `child`, then the call site's, which still wins over both exactly as it did before the
    // ambient layer existed.
    sink(level, lineFor(level, event, { ...currentLogContext(), ...base, ...fields }));
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child: (fields) => createLogger({ ...options, fields: { ...base, ...fields } }),
  };
}

/**
 * Fields stamped on every line written while a request is being handled.
 *
 * Phase 3 lane E, security spec row L1. `dispatch` (`./router.ts`) opens this around the handler
 * with the **verified session's** tenant id, so every line that handler or anything it awaits
 * writes names the tenant it was written for, without 300 call sites having to thread a logger.
 * The id is the session's own and never the client-supplied workspace cookie, so a line can be
 * trusted to say who the work was actually done for.
 *
 * Off server mode nothing opens the store, so the desktop's and webdev's lines are byte-identical
 * to what they were: there is one tenant there, and naming it on every line says nothing.
 *
 * The same async-local idiom as `./tenant-scope.ts`, with the same limit — work that outlives its
 * request loses the context, which is correct, because it is no longer that request's work.
 */
const logContext = new AsyncLocalStorage<LogFields>();

/** Run `fn` with `fields` stamped on every line it, and everything it awaits, writes. */
export function withLogContext<T>(fields: LogFields, fn: () => Promise<T>): Promise<T> {
  return logContext.run({ ...logContext.getStore(), ...fields }, fn);
}

/** The ambient request fields, or an empty object outside a request. */
export function currentLogContext(): LogFields {
  return logContext.getStore() ?? {};
}

/** The host's logger. Every line inside a request also carries `withLogContext`'s fields. */
export const log: Logger = createLogger();
