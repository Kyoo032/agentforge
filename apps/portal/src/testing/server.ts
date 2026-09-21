/**
 * A real portal on an ephemeral port, for the integration suites.
 *
 * Real `node:http`, real routes, real Postgres through `createTestStore` (so real RLS, as a
 * non-superuser member of `portal_app`). The two things that are not real are the ones that would
 * otherwise reach outside the process: the mail transport is captured in memory, and the log sink
 * is an array -- which is what lets a test assert that no OTP, code or token ever reached a log
 * line, rather than asserting it by reading the source.
 */
import { createLogger, type Logger } from "../log";
import type { PortalConfig } from "../config";
import { createRuntime, type PortalRuntime } from "../flows/context";
import { resolveKeyring } from "../jwt/keys";
import type { MailMessage, Mailer, SentMail } from "../mail/types";
import { registerPortalRoutes } from "../routes";
import { createPortalServer, type PortalServer } from "../server";
import { createTestStore, type TestStore } from "./pg";
import type { Clock } from "../store/types";

export interface CapturedMail extends MailMessage {
  /** The six digits, pulled out of the body so a test does not have to parse copy. */
  readonly code: string | null;
}

export interface TestMailer extends Mailer {
  readonly sent: readonly CapturedMail[];
  /** Makes the next `send` throw, so the neutral-page-on-SMTP-failure path can be driven. */
  failNext(): void;
  newest(): CapturedMail | null;
  clear(): void;
}

export function createTestMailer(): TestMailer {
  const sent: CapturedMail[] = [];
  let failing = false;

  return {
    sent,
    failNext() {
      failing = true;
    },
    newest: () => sent.at(-1) ?? null,
    clear() {
      sent.length = 0;
    },
    async send(message: MailMessage): Promise<SentMail> {
      if (failing) {
        failing = false;
        throw new Error("transport refused the message");
      }
      sent.push({ ...message, code: /\b(\d{6})\b/.exec(message.text)?.[1] ?? null });
      return { messageId: `test-${sent.length}`, accepted: [message.to] };
    },
    async close() {},
  };
}

export function testConfig(overrides: Partial<PortalConfig> = {}): PortalConfig {
  return Object.freeze({
    production: false,
    host: "127.0.0.1",
    port: 0,
    dataDir: "/tmp/portal-test",
    databaseUrl: "postgres://unused",
    signingKey: Buffer.alloc(32, 42),
    devOutbox: false,
    allowManualOtp: false,
    // The suites listen on an ephemeral port, so the issuer is passed to `createRuntime` after
    // `listen` rather than guessed here. Null is the honest value: nothing is in front.
    publicUrl: null,
    trustProxy: false,
    smtp: {
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      requireTls: false,
      ignoreTls: true,
      user: null,
      pass: null,
      from: "DPSBuddy <no-reply@portal.test>",
    },
    ...overrides,
  });
}

export interface PortalHarness {
  readonly runtime: PortalRuntime;
  readonly server: PortalServer;
  readonly store: TestStore;
  readonly mailer: TestMailer;
  readonly log: Logger;
  /** Every line the logger wrote, already redacted by `src/log.ts`. */
  readonly logLines: readonly string[];
  readonly origin: string;
  close(): Promise<void>;
}

export interface StartPortalOptions {
  readonly clock?: Clock;
  readonly config?: Partial<PortalConfig>;
  readonly trustProxy?: boolean;
}

export async function startTestPortal(options: StartPortalOptions = {}): Promise<PortalHarness> {
  const store = await createTestStore(options.clock);
  const mailer = createTestMailer();
  const logLines: string[] = [];
  const log = createLogger({
    env: { PORTAL_LOG_LEVEL: "debug" },
    sink: (_level, line) => logLines.push(line),
  });

  const config = testConfig(options.config);
  const keys = resolveKeyring(config, log);
  const server = createPortalServer({ config, store: store.store, log, clock: options.clock });

  // Listen first: the issuer has to name the port the OS actually handed out, because it is both
  // the token's `iss` and the `verification_uri` the device flow prints.
  const { port } = await server.listen();
  const origin = `http://127.0.0.1:${port}`;

  const runtime = createRuntime({
    config,
    store: store.store,
    log,
    mailer,
    keys,
    clock: options.clock,
    issuer: origin,
    trustProxy: options.trustProxy ?? false,
  });
  registerPortalRoutes(server, runtime);

  return {
    runtime,
    server,
    store,
    mailer,
    log,
    logLines,
    origin,
    async close() {
      await server.close();
      await store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// A browser: one cookie jar, no redirect following
// ---------------------------------------------------------------------------

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  json<T = unknown>(): T;
  readonly location: string | null;
}

export interface Agent {
  get(path: string, init?: RequestInit): Promise<Reply>;
  postForm(path: string, fields: Readonly<Record<string, string>>): Promise<Reply>;
  postJson(path: string, body: unknown, init?: RequestInit): Promise<Reply>;
  /** The cookie jar, so a test can assert what was set and forge what was not. */
  readonly cookies: Map<string, string>;
  cookieHeader(): string;
}

export function createAgent(origin: string): Agent {
  const cookies = new Map<string, string>();

  const remember = (response: Response): void => {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) {
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (value === "" || /Max-Age=0/i.test(raw)) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
    }
  };

  const cookieHeader = (): string =>
    [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");

  const call = async (path: string, init: RequestInit): Promise<Reply> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set("cookie", cookieHeader());
    }
    // `manual` so a test sees the 302 itself: the whole point of several of them is the Location.
    const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: "manual" });
    remember(response);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: <T,>() => JSON.parse(text) as T,
      location: response.headers.get("location"),
    };
  };

  return {
    cookies,
    cookieHeader,
    get: (path, init = {}) => call(path, { ...init, method: "GET" }),
    postForm: (path, fields) =>
      call(path, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    postJson: (path, body, init = {}) =>
      call(path, {
        ...init,
        method: "POST",
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        body: JSON.stringify(body),
      }),
  };
}

/** `name="x" value="y"` out of a rendered form, so a test fills the page it was given. */
export function hiddenValue(html: string, name: string): string | null {
  const pattern = new RegExp(`name="${name}" value="([^"]*)"`);
  return pattern.exec(html)?.[1] ?? null;
}
