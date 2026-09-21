/**
 * Phase 6 — the Tencent COS backend behind `tenant-storage.ts`.
 *
 * COS speaks an S3-shaped REST API over HTTPS with Tencent's own request signature (the "v5"
 * scheme: an HMAC-SHA1 signing key derived from a time window, then an HMAC-SHA1 over a canonical
 * request). There is an official SDK; this file signs the four requests the store needs instead,
 * for three reasons worth stating because they are the reason a reviewer will ask:
 *
 * 1. **The cloud container cannot reach Tencent** (`api.tencentcloudapi.com` and the COS endpoints
 *    are outside this environment's network policy), so the adapter has to be provable against a
 *    stub. An injectable `fetch` and an injectable clock make every byte of the signature and every
 *    request line assertable without a bucket; a vendored SDK would make that a mock of the SDK,
 *    which proves nothing about what goes on the wire.
 * 2. **Four verbs.** PUT, GET (with `Range`), HEAD, DELETE and one LIST. The SDK is a large
 *    dependency and a large attack surface for that.
 * 3. **Credentials.** The runbook's production path is the CVM instance role, whose temporary
 *    credentials come from the metadata service and expire; that refresh has to be visible here
 *    rather than buried.
 *
 * **Nothing is hardcoded.** The bucket, the region, the endpoint and the credentials all come from
 * the environment the runbook describes (`docs/internal/tencent-cvm-setup.md` §5 and §7,
 * `webapp-deploy/.env.example`). `createCosObjectStore()` throws when they are missing rather than
 * handing back the file store: a silent fall back to a directory nobody backs up is the failure
 * `tenant-storage.ts` exists to prevent.
 *
 * **Keys are checked before they are sent.** Every method calls `assertObjectKey` first, so a key
 * that does not belong to the calling tenant never becomes a request at all — the bucket is not
 * asked to be the access-control boundary, because a bucket policy cannot see which signed-in
 * tenant a request is for.
 */
import { createHash, createHmac } from "node:crypto";
import { ApiError, type TenantStorageUse } from "@agentforge/core";
import { parseByteRange, type RangedBytes } from "./byte-range";
import { log } from "./log";
import {
  assertObjectKey,
  assertPurgeableTenant,
  isObjectKeyInsideTenant,
  tenantKeyPrefix,
  type ObjectHead,
  type TenantObjectStore,
} from "./tenant-object-keys";

/* ------------------------------------------------------------------------------ configuration */

export type CosCredentials = {
  readonly secretId: string;
  readonly secretKey: string;
  /** Present only for a temporary credential from the CVM instance role. */
  readonly sessionToken?: string;
  /** Epoch ms this credential stops being usable. `null` for a static one. */
  readonly expiresAtMs: number | null;
};

export type CosConfig = {
  readonly bucket: string;
  readonly region: string;
  /** `https://<bucket>.cos.<region>.myqcloud.com`, or `COS_ENDPOINT` when an operator overrides it. */
  readonly endpoint: string;
  /** The CAM role whose temporary credentials the metadata service hands out, when in use. */
  readonly camRole: string | null;
  readonly metadataBase: string;
};

/**
 * The metadata service on a Tencent CVM. A link-local address, as on every other cloud: it is only
 * reachable from the instance itself, which is what makes "the instance role" an identity at all.
 */
const DEFAULT_METADATA_BASE = "http://metadata.tencentyunapi.com";

/** Refresh a temporary credential this long before it expires, so an in-flight request never uses one that dies mid-call. */
const CREDENTIAL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** How long a signature is valid. Short, because a leaked signed request is a bearer token for its window. */
const SIGNATURE_WINDOW_SECONDS = 300;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ApiError(
      "storage_not_configured",
      `Object storage is set to COS but ${name} is not set. See docs/internal/tencent-cvm-setup.md §12.`,
      500,
    );
  }
  return value;
}

export function cosConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CosConfig {
  const bucket = required(env, "COS_MEDIA_BUCKET");
  const region = required(env, "TENCENT_REGION");
  const endpoint = env.COS_ENDPOINT?.trim() || `https://${bucket}.cos.${region}.myqcloud.com`;
  if (!endpoint.startsWith("https://")) {
    // The bucket holds tenants' uploads and the signature is a bearer credential for its window;
    // neither travels over cleartext, whatever an operator typed.
    throw new ApiError("storage_not_configured", "COS_ENDPOINT must be an https:// URL", 500);
  }
  return {
    bucket,
    region,
    endpoint: endpoint.replace(/\/+$/, ""),
    camRole: env.COS_CAM_ROLE?.trim() || null,
    metadataBase: (env.COS_METADATA_BASE?.trim() || DEFAULT_METADATA_BASE).replace(/\/+$/, ""),
  };
}

/* ---------------------------------------------------------------------------- the credentials */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Where a request's credentials come from.
 *
 * Static `COS_SECRET_ID` / `COS_SECRET_KEY` is the local and staging path. Production is the CAM
 * instance role: `deploy.sh` already reads the wrap key and the backup passphrase that way
 * (`webapp-deploy/scripts/deploy.sh`), and a long-lived key pair on the box is exactly what the
 * security spec's S2 says not to have.
 */
export function createCredentialProvider(
  config: CosConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): () => Promise<CosCredentials> {
  const staticId = env.COS_SECRET_ID?.trim();
  const staticKey = env.COS_SECRET_KEY?.trim();
  if (staticId && staticKey) {
    const credentials: CosCredentials = {
      secretId: staticId,
      secretKey: staticKey,
      ...(env.COS_SESSION_TOKEN?.trim() ? { sessionToken: env.COS_SESSION_TOKEN.trim() } : {}),
      expiresAtMs: null,
    };
    return async () => credentials;
  }
  if (!config.camRole) {
    throw new ApiError(
      "storage_not_configured",
      "Object storage is set to COS but no credentials are configured: set COS_SECRET_ID and " +
        "COS_SECRET_KEY, or COS_CAM_ROLE for the CVM instance role.",
      500,
    );
  }

  let cached: CosCredentials | null = null;
  let inFlight: Promise<CosCredentials> | null = null;

  const fetchRole = async (): Promise<CosCredentials> => {
    const url = `${config.metadataBase}/latest/meta-data/cam/security-credentials/${encodeURIComponent(config.camRole ?? "")}`;
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new ApiError("storage_credentials_unavailable", `The instance role returned ${response.status}`, 502);
    }
    const body = (await response.json()) as {
      TmpSecretId?: string;
      TmpSecretKey?: string;
      Token?: string;
      ExpiredTime?: number;
      Code?: string;
    };
    if (body.Code && body.Code !== "Success") {
      throw new ApiError("storage_credentials_unavailable", `The instance role answered ${body.Code}`, 502);
    }
    if (!body.TmpSecretId || !body.TmpSecretKey || !body.Token) {
      throw new ApiError("storage_credentials_unavailable", "The instance role returned no usable credential", 502);
    }
    // `ExpiredTime` is epoch SECONDS, like every other Tencent timestamp; everything else in this
    // codebase is milliseconds, so it is converted here rather than at each comparison.
    const expiresAtMs = typeof body.ExpiredTime === "number" ? body.ExpiredTime * 1000 : now() + 30 * 60 * 1000;
    return { secretId: body.TmpSecretId, secretKey: body.TmpSecretKey, sessionToken: body.Token, expiresAtMs };
  };

  return async () => {
    if (cached && (cached.expiresAtMs === null || cached.expiresAtMs - CREDENTIAL_REFRESH_MARGIN_MS > now())) {
      return cached;
    }
    // One refresh at a time. Without this, a burst of uploads on a cold process would each call the
    // metadata service, which rate-limits, and the first 429 would fail an upload for no reason.
    if (!inFlight) {
      inFlight = fetchRole()
        .then((fresh) => {
          cached = fresh;
          return fresh;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}

/* ------------------------------------------------------------------------------- the signature */

/** RFC 3986, which is what COS canonicalises with: `!'()*` are escaped too, and `/` is not special. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSha1Hex(key: string, value: string): string {
  return createHmac("sha1", key).update(value, "utf8").digest("hex");
}

function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

/** `key=value&…` over lower-cased, RFC-3986-encoded keys in ascending order, plus the key list. */
function canonicalPairs(input: Record<string, string>): { list: string; joined: string } {
  const entries = Object.entries(input)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return {
    list: entries.map(([key]) => key).join(";"),
    joined: entries.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join("&"),
  };
}

export type SignInput = {
  readonly method: string;
  /** The object path, starting with `/`, NOT yet encoded. */
  readonly pathname: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly credentials: CosCredentials;
  readonly startSeconds: number;
  readonly windowSeconds?: number;
};

/**
 * Tencent's COS request signature, v5.
 *
 *   SignKey     = HMAC-SHA1(SecretKey, KeyTime)
 *   HttpString  = method\npath\nquery\nheaders\n
 *   StringToSign= sha1\nKeyTime\nSHA1(HttpString)\n
 *   Signature   = HMAC-SHA1(SignKey, StringToSign)
 *
 * The path is signed **unencoded** apart from its segments' own percent-encoding, and the header
 * and query lists name exactly what was signed — a header not in `q-header-list` is not covered,
 * which is why `host` is always signed and why `content-length` is signed on a PUT.
 */
export function signCosRequest(input: SignInput): string {
  const window = input.windowSeconds ?? SIGNATURE_WINDOW_SECONDS;
  const keyTime = `${input.startSeconds};${input.startSeconds + window}`;
  const signKey = hmacSha1Hex(input.credentials.secretKey, keyTime);
  const query = canonicalPairs(input.query);
  const headers = canonicalPairs(input.headers);
  const httpString = [input.method.toLowerCase(), input.pathname, query.joined, headers.joined, ""].join("\n");
  const stringToSign = ["sha1", keyTime, sha1Hex(httpString), ""].join("\n");
  const signature = hmacSha1Hex(signKey, stringToSign);
  return [
    "q-sign-algorithm=sha1",
    `q-ak=${input.credentials.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headers.list}`,
    `q-url-param-list=${query.list}`,
    `q-signature=${signature}`,
  ].join("&");
}

/* ---------------------------------------------------------------------------------- the client */

export type CosClientOptions = {
  readonly config?: CosConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
};

type CosResponse = { status: number; headers: Headers; bytes: Uint8Array };

/** One object key in a listing. */
type CosListEntry = { key: string; sizeBytes: number };

function xmlText(body: string, tag: string): string | null {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? (match[1] ?? null) : null;
}

/** COS answers an error with an XML body carrying a `<Code>`; it is the only useful part of it. */
function cosErrorCode(bytes: Uint8Array): string | null {
  try {
    return xmlText(Buffer.from(bytes).toString("utf8"), "Code");
  } catch {
    return null;
  }
}

export function createCosObjectStore(options: CosClientOptions = {}): TenantObjectStore {
  const env = options.env ?? process.env;
  const config = options.config ?? cosConfigFromEnv(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const credentialsFor = createCredentialProvider(config, env, fetchImpl, now);

  const objectUrl = (key: string, query: Record<string, string>): string => {
    // Each segment is encoded on its own: `/` separates segments and must survive, everything else
    // in a segment (a space, a `+`, a `#`) must not.
    const pathname = `/${key.split("/").map(encodeRfc3986).join("/")}`;
    const search = Object.entries(query)
      .map(([name, value]) => (value === "" ? encodeRfc3986(name) : `${encodeRfc3986(name)}=${encodeRfc3986(value)}`))
      .join("&");
    return `${config.endpoint}${pathname}${search ? `?${search}` : ""}`;
  };

  const host = new URL(config.endpoint).host;

  const send = async (
    method: string,
    key: string,
    options2: { query?: Record<string, string>; headers?: Record<string, string>; body?: Uint8Array } = {},
  ): Promise<CosResponse> => {
    const query = options2.query ?? {};
    const credentials = await credentialsFor();
    // `host` is always signed. `content-length` and `content-type` are signed on a body-carrying
    // request so neither can be swapped in flight. `range` is deliberately NOT signed: it changes
    // which bytes come back and none of who may have them, and COS does not require it.
    const signed: Record<string, string> = { host, ...(options2.headers ?? {}) };
    const authorization = signCosRequest({
      method,
      pathname: `/${key.split("/").map(encodeRfc3986).join("/")}`,
      query,
      headers: signed,
      credentials,
      startSeconds: Math.floor(now() / 1000),
    });
    const wire: Record<string, string> = { ...signed, Authorization: authorization };
    delete wire.host; // `fetch` sets Host itself and refuses to have it set.
    if (credentials.sessionToken) {
      wire["x-cos-security-token"] = credentials.sessionToken;
    }
    const init: RequestInit = { method, headers: wire };
    if (options2.body) {
      // A fresh view over the same memory: `BodyInit` in the DOM lib wants a BufferSource, and a
      // `Uint8Array<ArrayBufferLike>` (which is what a Node Buffer widens to) does not satisfy it.
      init.body = new Uint8Array(options2.body) as unknown as RequestInit["body"];
    }
    const response = await fetchImpl(objectUrl(key, query), init);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes };
  };

  const fail = (action: string, key: string, response: CosResponse): never => {
    const code = cosErrorCode(response.bytes);
    log.warn("cos_request_failed", { action, status: response.status, code: code ?? "unknown" });
    throw new ApiError(
      "storage_unavailable",
      `Object storage refused the ${action} (${response.status}${code ? ` ${code}` : ""}).`,
      502,
    );
  };

  const notFound = (): never => {
    throw new ApiError("not_found", "That file is not available on this account", 404);
  };

  /**
   * One paginated listing walk over a tenant's prefix, used to measure and to purge.
   *
   * A bucket listing is paginated and a tenant can hold more than one page. The loop is bounded by
   * the listing itself: COS only sets `IsTruncated` while there is more, and a marker that does not
   * move would spin, so an unmoved marker ends the walk.
   *
   * The marker has to follow the **last key of the page**, not the last key this tenant owns. For
   * the local tenant the prefix is empty, so a page can be entirely other tenants' objects;
   * advancing only on an owned entry left the marker where it was, and a truncated page with no
   * `NextMarker` then re-fetched the same page until the cap below — 10,000 billed calls.
   *
   * `onOwned` runs for each entry that belongs to `tenantId` and for no other, which is what keeps
   * a purge of the local tenant's (empty) prefix from reaching every other tenant's objects even
   * if the guard above it were ever removed.
   */
  const walkPrefix = async (
    tenantId: string,
    onOwned: ((key: string) => Promise<void>) | null,
  ): Promise<TenantStorageUse> => {
    const prefix = tenantKeyPrefix(tenantId);
    let marker = "";
    let usedBytes = 0;
    let objectCount = 0;
    for (let page = 0; page < 10_000; page += 1) {
      const startedAt = marker;
      const query: Record<string, string> = { "max-keys": "1000" };
      if (prefix) {
        query.prefix = prefix;
      }
      if (marker) {
        query.marker = marker;
      }
      const response = await send("GET", "", { query });
      if (response.status !== 200) {
        fail("listing", prefix, response);
      }
      const body = Buffer.from(response.bytes).toString("utf8");
      for (const entry of parseCosListing(body)) {
        // Every entry moves the marker; only this tenant's entries are counted or acted on. The
        // local tenant's prefix is empty, so a plain listing would otherwise count every OTHER
        // tenant's objects as its own. This is `tenantDeniedRoots` on the bucket.
        marker = entry.key;
        if (!isObjectKeyInsideTenant(tenantId, entry.key)) {
          continue;
        }
        usedBytes += entry.sizeBytes;
        objectCount += 1;
        if (onOwned) {
          await onOwned(entry.key);
        }
      }
      if (xmlText(body, "IsTruncated") !== "true") {
        break;
      }
      const next = xmlText(body, "NextMarker");
      if (next) {
        marker = next;
      }
      // Nothing to ask for next, or the same request as last time: stop rather than spin. COS
      // documents `NextMarker` on every truncated response, so this is the guard, not the path.
      if (!marker || marker === startedAt) {
        break;
      }
    }
    return { usedBytes, objectCount };
  };

  const store: TenantObjectStore = {
    kind: "cos",

    async put(tenantId, key, bytes, contentType) {
      assertObjectKey(tenantId, key);
      const response = await send("PUT", key, {
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": contentType || "application/octet-stream",
        },
        body: bytes,
      });
      if (response.status !== 200) {
        fail("upload", key, response);
      }
    },

    async read(tenantId, key) {
      assertObjectKey(tenantId, key);
      const response = await send("GET", key);
      if (response.status === 404) {
        notFound();
      }
      if (response.status !== 200) {
        fail("download", key, response);
      }
      return response.bytes;
    },

    async readRange(tenantId, key, rangeHeader): Promise<RangedBytes> {
      assertObjectKey(tenantId, key);
      // The size has to be known before the range can be reported (`Content-Range: …/<size>`) and
      // before an unsatisfiable range can be told apart from a served one, so HEAD first. COS
      // prices a HEAD as a read request; that is the cost of answering 416 correctly.
      const head = await store.head(tenantId, key);
      if (head === null) {
        throw new ApiError("not_found", "That file is not available on this account", 404);
      }
      const size = head.sizeBytes;
      const range = parseByteRange(rangeHeader, size);
      if (range === "unsatisfiable") {
        return {
          status: 416,
          bytes: new Uint8Array(0),
          headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
        };
      }
      const response = await send("GET", key, {
        ...(range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {}),
      });
      if (response.status === 404) {
        notFound();
      }
      if (response.status !== 200 && response.status !== 206) {
        fail("download", key, response);
      }
      if (!range) {
        return {
          status: 200,
          bytes: response.bytes,
          headers: { "Accept-Ranges": "bytes", "Content-Length": String(response.bytes.byteLength) },
        };
      }
      return {
        status: 206,
        bytes: response.bytes,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(response.bytes.byteLength),
        },
      };
    },

    async head(tenantId, key): Promise<ObjectHead | null> {
      assertObjectKey(tenantId, key);
      const response = await send("HEAD", key);
      if (response.status === 404) {
        return null;
      }
      if (response.status !== 200) {
        fail("stat", key, response);
      }
      const length = Number(response.headers.get("content-length") ?? "0");
      return { sizeBytes: Number.isFinite(length) && length >= 0 ? length : 0 };
    },

    async remove(tenantId, key) {
      assertObjectKey(tenantId, key);
      const response = await send("DELETE", key);
      // COS answers 204 for a delete and 204 again for a key that was never there, which is the
      // idempotence the interface promises.
      if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
        fail("delete", key, response);
      }
    },

    async measure(tenantId) {
      return walkPrefix(tenantId, null);
    },

    /**
     * Phase 8 — delete every object this tenant holds, one page of the listing at a time.
     *
     * The same walk `measure` runs, with a DELETE per owned entry. Page by page rather than
     * "collect every key, then delete": a tenant with a full 20 GiB of small objects has a lot of
     * keys, and holding all of them in memory to save nothing is the wrong trade. Deleting inside
     * the walk is safe because the marker is a *key position* in a sorted listing, not a cursor
     * into a snapshot — the next page is "keys after this one", and keys that are now gone simply
     * do not come back.
     *
     * A DELETE per object rather than the batch POST: the batch API is one more signed shape to
     * get right for an operation that runs once per account, ever, and a per-key delete is the one
     * `remove` already proves against a real bucket. If a reset ever becomes slow enough to matter,
     * this is the line to change.
     *
     * NOT atomic. A failure part way leaves some objects deleted and some not, which is why the
     * reset that drives this is safe to run again — a second pass deletes what the first missed
     * and reports zero for what it already took.
     */
    async removePrefix(tenantId) {
      assertPurgeableTenant(tenantId);
      return walkPrefix(tenantId, async (key) => {
        const response = await send("DELETE", key);
        // 204 for a delete, 204 again for a key that was never there, 200 from some gateways.
        if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
          fail("delete", key, response);
        }
      });
    },

    describe(tenantId, key) {
      return `cos://${config.bucket}/${assertObjectKey(tenantId, key)}`;
    },
  };

  return store;
}

/**
 * The `<Contents>` entries of a COS listing. A regex rather than an XML parser on purpose: the
 * shape is fixed, the alternative is a dependency, and anything this does not understand is
 * skipped rather than guessed at — a listing entry that cannot be read contributes zero bytes,
 * which under-counts a tenant rather than refusing them.
 */
export function parseCosListing(body: string): CosListEntry[] {
  const entries: CosListEntry[] = [];
  for (const block of body.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
    const key = xmlText(block, "Key");
    const size = xmlText(block, "Size");
    if (!key) {
      continue;
    }
    const sizeBytes = Number(size ?? "0");
    entries.push({ key: decodeXmlEntities(key), sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0 });
  }
  return entries;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
