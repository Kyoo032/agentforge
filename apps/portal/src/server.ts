/**
 * The HTTP server.
 *
 * `node:http` and a small route table, the same idiom `packages/host/src/http-adapter.ts` uses —
 * one place that parses, one place that answers, no framework. It is copied in spirit, never
 * imported: the portal is the backend team's service and depends on nothing in this repo.
 *
 * Today it serves `GET /healthz` and nothing else. Lane B registers the real routes through
 * `register`, so adding `/authorize`, `/auth/token` and friends is a list of route objects and
 * not a rewrite of this file.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PortalConfig } from "./config";
import { errorBody } from "./flows/reasons";
import { log as defaultLog, type Logger } from "./log";
import type { Clock, PortalStore } from "./store/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface PortalRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The raw body, read once, capped at `MAX_BODY_BYTES`. */
  readonly body: string;
  /** The client address, honouring `X-Forwarded-For` only behind the proxy. */
  readonly ip: string | null;
}

export interface PortalResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly json?: unknown;
  /**
   * A binary body, for the one response here that is not text: the brand mark
   * (`routes/assets.ts`). It exists because `body` is a string and a string is written as utf8 --
   * a PNG sent that way arrives re-encoded and does not decode, while still looking like a 200
   * with an `image/png` on it. `bytes` wins over `body` and `json` when all three are somehow set.
   */
  readonly bytes?: Buffer;
}

export interface PortalRoute {
  readonly method: HttpMethod;
  readonly path: string;
  handle(request: PortalRequest, context: PortalContext): Promise<PortalResponse> | PortalResponse;
}

export interface PortalContext {
  readonly config: PortalConfig;
  readonly store: PortalStore;
  readonly clock: Clock;
  readonly log: Logger;
}

export interface CreatePortalServerOptions {
  readonly config: PortalConfig;
  readonly store: PortalStore;
  readonly clock?: Clock;
  readonly log?: Logger;
  readonly routes?: readonly PortalRoute[];
}

export interface PortalServer {
  readonly server: Server;
  readonly context: PortalContext;
  /** Adds a route. Lane B's entire surface arrives this way. */
  register(route: PortalRoute): void;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

/** Nothing the portal accepts is large; a login body is a few hundred bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

const NOT_FOUND: PortalResponse = { status: 404, json: { error: "not_found" } };
const METHOD_NOT_ALLOWED: PortalResponse = { status: 405, json: { error: "method_not_allowed" } };
/** A 5xx says nothing about what broke — no path, no SQL, no stack. */
const INTERNAL: PortalResponse = { status: 500, json: { error: "internal_error" } };
/**
 * The one refusal the caller can act on, in the shape every other refusal uses
 * (`flows/reasons.ts`). It used to be a thrown `Error` that fell into the catch-all above and came
 * back as `500 internal_error`, which told a caller the server had broken rather than that their
 * body was too big.
 */
const TOO_LARGE: PortalResponse = { status: 413, json: errorBody("invalid_request") };
/** A request target the URL parser refuses: the caller's mistake, in the same shape as the 413. */
const BAD_TARGET: PortalResponse = { status: 400, json: errorBody("invalid_request") };

/**
 * What every request target is resolved against. It is fixed, and it never comes from the Host
 * header: only the path and the query are read from the result, and both come from the request
 * line alone. Building the base from `Host` meant `Host: a b` produced an invalid base URL. The
 * parse also used to run outside the handler's try, so that TypeError killed the process.
 */
const REQUEST_BASE = "http://portal.local";

/** `null` for a target the parser refuses, e.g. `//x:99999/healthz` (a port out of range). */
function parseTarget(target: string | undefined): URL | null {
  try {
    return new URL(target ?? "/", REQUEST_BASE);
  } catch {
    return null;
  }
}

/** Distinguishable from a handler's own failure, which is what keeps the 413 out of the 500. */
class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

export const HEALTH_PATH = "/healthz";

function healthRoute(): PortalRoute {
  return {
    method: "GET",
    path: HEALTH_PATH,
    handle(_request, context) {
      // Deliberately says nothing about the database, the tenant list or the build. A health probe
      // is reachable from the proxy, so it answers liveness and not an inventory.
      return { status: 200, json: { status: "ok", time: context.clock.now().toISOString() } };
    },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * For the case where the error path failed as well: a logger that throws (stderr gone, EPIPE), or a
 * response that cannot be written. Nothing here may throw, because the caller is the last `.catch`
 * on the request. An unhandled rejection is fatal to the process (`process-guards.ts`), so if a
 * request could reach one, any client could stop the portal.
 */
function abandon(response: ServerResponse, logger: Logger, method: string, error: unknown): void {
  try {
    logger.error("request_abandoned", { method, reason: error instanceof Error ? error.message : "unknown" });
  } catch {
    // The logger is what failed; there is nowhere left to say so.
  }
  try {
    if (response.headersSent) {
      response.destroy();
    } else {
      send(response, INTERNAL);
    }
  } catch {
    response.destroy();
  }
}

function send(response: ServerResponse, result: PortalResponse): void {
  const body: Buffer | string =
    result.bytes ?? (result.json !== undefined ? JSON.stringify(result.json) : (result.body ?? ""));
  const headers: Record<string, string> = {
    "content-type": result.json !== undefined ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "content-length": String(Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body)),
    // The portal names no framework and no version, same rule as the host's identity masking.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(result.headers ?? {}),
  };
  response.writeHead(result.status, headers);
  response.end(body);
}

export function createPortalServer(options: CreatePortalServerOptions): PortalServer {
  const clock = options.clock ?? options.store.clock;
  const logger = options.log ?? defaultLog;
  const context: PortalContext = Object.freeze({
    config: options.config,
    store: options.store,
    clock,
    log: logger,
  });

  const routes: PortalRoute[] = [healthRoute(), ...(options.routes ?? [])];

  const answer = async (incoming: IncomingMessage, response: ServerResponse, method: string): Promise<void> => {
    try {
      // Inside the try, against a fixed base: the request line is the client's to write, and a
      // target the parser refuses is a 400 for that client, not a crash for everybody.
      const url = parseTarget(incoming.url);
      if (!url) {
        send(response, BAD_TARGET);
        return;
      }
      const path = url.pathname;
      const matches = routes.filter((route) => route.path === path);
      if (matches.length === 0) {
        send(response, NOT_FOUND);
        return;
      }
      const route = matches.find((candidate) => candidate.method === method)
        // HEAD is answered by the GET handler with an empty body, as every HTTP client expects.
        ?? (method === "HEAD" ? matches.find((candidate) => candidate.method === "GET") : undefined);
      if (!route) {
        send(response, METHOD_NOT_ALLOWED);
        return;
      }

      const body = method === "GET" || method === "HEAD" ? "" : await readBody(incoming);
      const request: PortalRequest = Object.freeze({
        method,
        path,
        query: url.searchParams,
        headers: incoming.headers,
        body,
        ip: incoming.socket.remoteAddress ?? null,
      });

      const result = await route.handle(request, context);
      send(
        response,
        // `bytes` is cleared alongside `json` and `body`: a HEAD that still carried the PNG would
        // send the image under a method whose whole contract is headers only.
        method === "HEAD" ? { ...result, json: undefined, body: "", bytes: undefined } : result,
      );
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        send(response, TOO_LARGE);
        return;
      }
      // The event name and the reason, never the path or the payload.
      logger.error("request_failed", { method, reason: error instanceof Error ? error.message : "unknown" });
      send(response, INTERNAL);
    }
  };

  const server = createServer((incoming, response) => {
    const method = (incoming.method ?? "GET").toUpperCase();
    // Every request promise ends in this `.catch`. It used to be a `void`ed async function, which
    // meant a throw from the catch block above was an unhandled rejection.
    answer(incoming, response, method).catch((error: unknown) => abandon(response, logger, method, error));
  });

  return Object.freeze({
    server,
    context,
    register(route: PortalRoute) {
      routes.push(route);
    },
    listen() {
      return new Promise<{ host: string; port: number }>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        // Loopback unless PORTAL_HOST says otherwise: the portal sits behind the reverse proxy.
        server.listen(options.config.port, options.config.host, () => {
          server.removeListener("error", rejectListen);
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : options.config.port;
          resolveListen({ host: options.config.host, port });
        });
      });
    },
    close() {
      return new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    },
  });
}
