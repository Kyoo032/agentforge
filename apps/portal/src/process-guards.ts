/**
 * The last resort, installed by `main.ts` before anything else runs.
 *
 * An unhandled rejection or an uncaught exception means something failed where nothing was
 * listening. Node's default is to print a raw stack to stderr and exit. This keeps the exit, but
 * writes the record through the portal's own logger first, so it lands in the same JSON stream as
 * every other line and passes through the same redaction at the sink (`src/log.ts`).
 *
 * **It does not keep the process running.** Node's documentation says that resuming after an
 * uncaught exception is unsafe, and an unhandled rejection gets the same treatment on purpose: a
 * process in a state nobody can describe is restarted by its supervisor (compose `restart:`), not
 * trusted. Exiting is safe only because no request can get here. `server.ts` answers a target it
 * cannot parse with a 400 and ends every request promise in a `.catch`, so a client cannot use this
 * handler to stop the portal. Before that fix, `Host: a b` did exactly that.
 */
import type { Logger } from "./log";

export type FatalProcessEvent = "unhandledRejection" | "uncaughtException";

/** The slice of `process` this needs, so a test can hand it an `EventEmitter`. */
export interface ProcessEvents {
  on(event: FatalProcessEvent, listener: (reason: unknown) => void): unknown;
}

export interface ProcessGuardOptions {
  readonly target: ProcessEvents;
  readonly log: Logger;
  readonly exit: (code: number) => void;
}

/**
 * `Name: message` for an Error. For anything else, only its type: a value somebody threw is not a
 * log field, and it can be a code or a token as easily as a string.
 */
export function describeFailure(value: unknown): string {
  if (value instanceof Error) {
    return value.message ? `${value.name}: ${value.message}` : value.name;
  }
  return `non-error value (${value === null ? "null" : typeof value})`;
}

export function installProcessGuards(options: ProcessGuardOptions): void {
  const fatal =
    (event: string) =>
    (reason: unknown): void => {
      try {
        options.log.error(event, { reason: describeFailure(reason) });
      } catch {
        // The logger is what failed. The exit below still has to happen.
      }
      options.exit(1);
    };
  options.target.on("unhandledRejection", fatal("portal_unhandled_rejection"));
  options.target.on("uncaughtException", fatal("portal_uncaught_exception"));
}
