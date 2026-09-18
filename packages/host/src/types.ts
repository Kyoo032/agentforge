/**
 * A cookie a handler asks the adapter to set. Attributes default to the strictest form the
 * workspace cookie has always had (`SameSite=Strict; HttpOnly`, session-scoped, no `Secure`); a
 * handler overrides only what it needs, e.g. the portal session cookie (`Lax`, `Secure` on the
 * hosted server, `Max-Age` for its lifetime).
 */
export type HostCookie = {
  name: string;
  value: string;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  httpOnly?: boolean;
  secure?: boolean;
  /** Seconds; `0` clears the cookie. Omitted = session cookie. */
  maxAge?: number;
};

export type HostFile = {
  field: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
};

/**
 * Who a verified browser session belongs to, as the router's session gate resolved it
 * (packages/host/src/router.ts, docs/internal/web-security-spec.md row T1).
 *
 * The ids only — never the record, never a portal token. Present on a hosted request that passed
 * the gate; absent on the desktop (IPC) and webdev, which have no session at all.
 */
export type HostSession = {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
};

export type HostRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  body?: unknown;
  files?: HostFile[];
  /** Cookie or host-process selected workspace. */
  workspaceId?: string | null;
  /**
   * The signed-in caller, in server mode only. Phase 3 (spec row T2) is what makes `getTenant()`
   * read it; until then no handler scopes anything by it and the hosted server is single-tenant.
   */
  session?: HostSession;
  /** Packaged IPC / client disconnect. Closes a wedged run stream. */
  abortSignal?: AbortSignal;
};

export type HostJsonResult = {
  type: "json";
  status: number;
  body: unknown;
  cookies?: HostCookie[];
};

export type HostStreamResult = {
  type: "stream";
  status: number;
  events: AsyncIterable<string>;
};

export type HostBytesResult = {
  type: "bytes";
  status: number;
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
  /** Extra response headers, e.g. Accept-Ranges / Content-Range for media seeking. */
  headers?: Record<string, string>;
};

export type HostResult = HostJsonResult | HostStreamResult | HostBytesResult;

export type HostHandler = (request: HostRequest) => Promise<HostResult>;
