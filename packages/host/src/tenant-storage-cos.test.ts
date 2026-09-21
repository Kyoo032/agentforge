/**
 * Phase 6 — the COS backend, proved against a stub.
 *
 * This container cannot reach Tencent (the network policy blocks it), so the live proof is on
 * kyo's machine — `docs/internal/web-phase6-tenant-storage.md` §8 lists it. What CAN be proved here
 * is everything that decides whether that live call will work: the exact bytes of the signature,
 * the exact request line and headers each verb produces, the credential refresh, the listing walk,
 * and — the part that matters most — that a key which is not the caller's never becomes a request
 * at all.
 *
 * The signature vectors below are computed from the algorithm Tencent documents:
 *
 *   SignKey      = HMAC-SHA1(SecretKey, KeyTime)
 *   HttpString   = method\npath\nquery\nheaders\n
 *   StringToSign = sha1\nKeyTime\nSHA1(HttpString)\n
 *   Signature    = HMAC-SHA1(SignKey, StringToSign)
 *
 * They are recomputed independently in the first test rather than pasted as a magic string, so a
 * change to the implementation that also changes the expectation cannot pass unnoticed.
 */
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";
import {
  cosConfigFromEnv,
  createCosObjectStore,
  createCredentialProvider,
  encodeRfc3986,
  parseCosListing,
  signCosRequest,
  type CosConfig,
  type FetchLike,
} from "./tenant-storage-cos";
import { purgeProgressOf } from "./tenant-object-keys";

const A = "tenant-alpha";
const B = "tenant-beta";
const KEY_A = `tenants/${A}/org-1/file.png`;

const CONFIG: CosConfig = {
  bucket: "dpsbuddy-media-1300000000",
  region: "ap-jakarta",
  endpoint: "https://dpsbuddy-media-1300000000.cos.ap-jakarta.myqcloud.com",
  camRole: null,
  metadataBase: "http://metadata.tencentyunapi.com",
};

const STATIC_ENV = { COS_SECRET_ID: "AKIDstatic", COS_SECRET_KEY: "secret-key-value" } as NodeJS.ProcessEnv;

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** A `fetch` that records what it was asked and answers from a queue. */
function stubFetch(answers: Array<{ status: number; body?: string | Uint8Array; headers?: Record<string, string> }>): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body,
    });
    const answer = answers.shift() ?? { status: 200, body: "" };
    const payload = typeof answer.body === "string" ? Buffer.from(answer.body) : (answer.body ?? new Uint8Array(0));
    // 204 and 304 must carry no body at all, and `Response` refuses to be built with one.
    const body = answer.status === 204 || answer.status === 304 ? null : Buffer.from(payload);
    return new Response(body, { status: answer.status, headers: answer.headers });
  };
  return { fetchImpl, calls };
}

function storeWith(answers: Parameters<typeof stubFetch>[0], env: NodeJS.ProcessEnv = STATIC_ENV) {
  const stub = stubFetch(answers);
  const store = createCosObjectStore({
    config: CONFIG,
    env,
    fetchImpl: stub.fetchImpl,
    now: () => 1_700_000_000_000,
  });
  return { store, calls: stub.calls };
}

function authOf(call: Call): Record<string, string> {
  const raw = call.headers.Authorization ?? call.headers.authorization ?? "";
  return Object.fromEntries(
    raw.split("&").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
  );
}

afterEach(() => {
  for (const name of [
    "COS_MEDIA_BUCKET",
    "TENCENT_REGION",
    "COS_ENDPOINT",
    "COS_CAM_ROLE",
    "COS_SECRET_ID",
    "COS_SECRET_KEY",
  ]) {
    delete process.env[name];
  }
});

describe("the v5 request signature", () => {
  it("is exactly what Tencent's algorithm produces, recomputed here", () => {
    const start = 1_700_000_000;
    const authorization = signCosRequest({
      method: "GET",
      pathname: `/${KEY_A}`,
      query: {},
      headers: { host: "example.cos.ap-jakarta.myqcloud.com" },
      credentials: { secretId: "AKIDstatic", secretKey: "secret-key-value", expiresAtMs: null },
      startSeconds: start,
      windowSeconds: 300,
    });

    const keyTime = `${start};${start + 300}`;
    const signKey = createHmac("sha1", "secret-key-value").update(keyTime).digest("hex");
    const httpString = ["get", `/${KEY_A}`, "", "host=example.cos.ap-jakarta.myqcloud.com", ""].join("\n");
    const stringToSign = ["sha1", keyTime, createHash("sha1").update(httpString).digest("hex"), ""].join("\n");
    const expected = createHmac("sha1", signKey).update(stringToSign).digest("hex");

    expect(authorization).toContain(`q-signature=${expected}`);
    expect(authorization).toContain("q-sign-algorithm=sha1");
    expect(authorization).toContain(`q-sign-time=${keyTime}`);
    expect(authorization).toContain(`q-key-time=${keyTime}`);
    expect(authorization).toContain("q-header-list=host");
    expect(authorization).toContain("q-url-param-list=");
  });

  it("names every header it covers, and covers every header it names", () => {
    const authorization = signCosRequest({
      method: "PUT",
      pathname: `/${KEY_A}`,
      query: {},
      headers: { "content-type": "image/png", host: "h", "content-length": "12" },
      credentials: { secretId: "id", secretKey: "key", expiresAtMs: null },
      startSeconds: 1,
    });
    // Sorted, lower-cased, `;`-joined — and it is the list a server re-derives the signature from,
    // so a header signed but not listed (or listed but not signed) fails on the real service and
    // would only show up as a 403 in production.
    expect(authorization).toContain("q-header-list=content-length;content-type;host");
  });

  it("signs query parameters in canonical order", () => {
    const authorization = signCosRequest({
      method: "GET",
      pathname: "/",
      query: { prefix: "tenants/a/", "max-keys": "1000", marker: "" },
      headers: { host: "h" },
      credentials: { secretId: "id", secretKey: "key", expiresAtMs: null },
      startSeconds: 1,
    });
    expect(authorization).toContain("q-url-param-list=marker;max-keys;prefix");
  });

  it("encodes to RFC 3986, not to encodeURIComponent's defaults", () => {
    // `!'()*` are left alone by `encodeURIComponent` and are NOT left alone by the signature spec.
    // A file called `it's (final)!.png` would sign one way and be requested another.
    expect(encodeRfc3986("it's (final)!*.png")).toBe("it%27s%20%28final%29%21%2A.png");
    expect(encodeRfc3986("a/b")).toBe("a%2Fb");
  });
});

describe("the requests each verb makes", () => {
  it("PUTs to the object's own URL with its length and type signed", async () => {
    const { store, calls } = storeWith([{ status: 200 }]);
    await store.put(A, KEY_A, new Uint8Array(12), "image/png");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(`${CONFIG.endpoint}/tenants/${A}/org-1/file.png`);
    expect(calls[0]?.headers["content-type"]).toBe("image/png");
    expect(calls[0]?.headers["content-length"]).toBe("12");
    expect(authOf(calls[0] as Call)["q-header-list"]).toBe("content-length;content-type;host");
    // `fetch` sets Host itself and refuses to have it set, but it still has to be SIGNED.
    expect(calls[0]?.headers.host).toBeUndefined();
  });

  it("GETs the object and hands back its bytes", async () => {
    const { store, calls } = storeWith([{ status: 200, body: "the bytes" }]);
    expect(Buffer.from(await store.read(A, KEY_A)).toString()).toBe("the bytes");
    expect(calls[0]?.method).toBe("GET");
  });

  it("HEADs for a size and answers null rather than throwing on a missing object", async () => {
    const present = storeWith([{ status: 200, headers: { "content-length": "4096" } }]);
    expect(await present.store.head(A, KEY_A)).toEqual({ sizeBytes: 4096 });

    const absent = storeWith([{ status: 404, body: "<Error><Code>NoSuchKey</Code></Error>" }]);
    expect(await absent.store.head(A, KEY_A)).toBeNull();
  });

  it("DELETEs, and treats a missing object as done", async () => {
    const { store, calls } = storeWith([{ status: 204 }]);
    await store.remove(A, KEY_A);
    expect(calls[0]?.method).toBe("DELETE");

    const absent = storeWith([{ status: 404 }]);
    await expect(absent.store.remove(A, KEY_A)).resolves.toBeUndefined();
  });

  it("serves a range with a Range header and the right Content-Range", async () => {
    const { store, calls } = storeWith([
      { status: 200, headers: { "content-length": "1000" } },
      { status: 206, body: "0123456789" },
    ]);
    const ranged = await store.readRange(A, KEY_A, "bytes=10-19");

    expect(calls[1]?.headers.range).toBe("bytes=10-19");
    expect(ranged.status).toBe(206);
    expect(ranged.headers["Content-Range"]).toBe("bytes 10-19/1000");
    expect(Buffer.from(ranged.bytes).toString()).toBe("0123456789");
  });

  it("answers 416 for a range past the end without fetching anything", async () => {
    const { store, calls } = storeWith([{ status: 200, headers: { "content-length": "10" } }]);
    const ranged = await store.readRange(A, KEY_A, "bytes=500-600");
    expect(ranged.status).toBe(416);
    expect(ranged.headers["Content-Range"]).toBe("bytes */10");
    // The HEAD, and no GET: there is nothing to download.
    expect(calls).toHaveLength(1);
  });

  it("turns a refusal from the service into a 502, never into a silent empty object", async () => {
    const { store } = storeWith([{ status: 403, body: "<Error><Code>AccessDenied</Code></Error>" }]);
    await expect(store.read(A, KEY_A)).rejects.toMatchObject({ code: "storage_unavailable", status: 502 });
  });

  it("turns a missing object into a 404", async () => {
    const { store } = storeWith([{ status: 404, body: "<Error><Code>NoSuchKey</Code></Error>" }]);
    await expect(store.read(A, KEY_A)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("a key that is not the caller's never reaches the bucket", () => {
  it("refuses before any request is made", async () => {
    for (const method of ["read", "head", "remove"] as const) {
      const { store, calls } = storeWith([{ status: 200 }]);
      await expect(store[method](A, `tenants/${B}/org-1/file.png`)).rejects.toThrow(ApiError);
      // The bucket is not asked to be the access-control boundary: a bucket policy cannot see
      // which signed-in tenant a request is for.
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses a traversal spelled inside the prefix", async () => {
    const { store, calls } = storeWith([{ status: 200 }]);
    await expect(store.put(A, `tenants/${A}/../${B}/x.png`, new Uint8Array(1), "image/png")).rejects.toThrow(ApiError);
    expect(calls).toHaveLength(0);
  });
});

describe("measuring a tenant's prefix", () => {
  const page = (entries: Array<[string, number]>, truncated: boolean, nextMarker?: string): string =>
    `<ListBucketResult>${entries
      .map(([key, size]) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`)
      .join(
        "",
      )}<IsTruncated>${truncated}</IsTruncated>${nextMarker ? `<NextMarker>${nextMarker}</NextMarker>` : ""}</ListBucketResult>`;

  it("lists only this tenant's prefix and sums it", async () => {
    const { store, calls } = storeWith([
      {
        status: 200,
        body: page(
          [
            [`tenants/${A}/org/a.png`, 100],
            [`tenants/${A}/org/b.png`, 250],
          ],
          false,
        ),
      },
    ]);
    expect(await store.measure(A)).toEqual({ usedBytes: 350, objectCount: 2 });
    expect(calls[0]?.url).toContain(`prefix=tenants%2F${A}%2F`);
  });

  it("follows the marker through more than one page", async () => {
    const { store, calls } = storeWith([
      { status: 200, body: page([[`tenants/${A}/1`, 10]], true, `tenants/${A}/1`) },
      { status: 200, body: page([[`tenants/${A}/2`, 20]], false) },
    ]);
    expect(await store.measure(A)).toEqual({ usedBytes: 30, objectCount: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("marker=");
  });

  it("does not bill the local tenant for everybody else in the bucket", async () => {
    // The local tenant's prefix is EMPTY, so a plain listing returns the whole bucket. This is
    // `tenantDeniedRoots` on the object store, and without it a single-tenant desktop upgraded in
    // place would show every hosted tenant's bytes as its own.
    const { store } = storeWith([
      {
        status: 200,
        body: page(
          [
            ["org/mine.png", 10],
            [`tenants/${A}/org/theirs.png`, 9000],
          ],
          false,
        ),
      },
    ]);
    expect(await store.measure(LOCAL_TENANT_ID)).toEqual({ usedBytes: 10, objectCount: 1 });
  });

  it("stops instead of re-fetching a page whose marker did not move", async () => {
    // Round 1 advanced the marker only on an entry this tenant owns. The local tenant's prefix is
    // empty, so a truncated page of somebody else's keys with no `NextMarker` left the marker where
    // it was and the same page was requested until the 10,000 cap — 10,000 billed LIST calls.
    // Every page after the first is the SAME truncated page of somebody else's keys, carrying no
    // `NextMarker` — which is exactly what a server that repeats itself looks like from here.
    const answers = [{ status: 200, body: page([["org/mine.png", 10]], true) }];
    for (let index = 0; index < 40; index += 1) {
      answers.push({ status: 200, body: page([[`tenants/${A}/stuck.png`, 5]], true) });
    }
    const { store, calls } = storeWith(answers);

    const measured = await store.measure(LOCAL_TENANT_ID);
    expect(measured).toEqual({ usedBytes: 10, objectCount: 1 });
    // Two pages at most: the first, then the one whose marker repeats, which ends the walk.
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("keeps walking when a page is entirely another tenant's but the marker advances", async () => {
    // The other half of the same rule: a foreign page must not end the walk either, or the local
    // tenant's own objects behind it would go uncounted.
    const { store } = storeWith([
      { status: 200, body: page([[`tenants/${A}/theirs-1.png`, 900]], true) },
      { status: 200, body: page([["org/mine.png", 42]], false) },
    ]);
    expect(await store.measure(LOCAL_TENANT_ID)).toEqual({ usedBytes: 42, objectCount: 1 });
  });

  it("skips a listing entry it cannot read rather than guessing at it", () => {
    const entries = parseCosListing(
      "<Contents><Key>a</Key><Size>5</Size></Contents><Contents><Size>9</Size></Contents>",
    );
    expect(entries).toEqual([{ key: "a", sizeBytes: 5 }]);
  });

  it("decodes an escaped key", () => {
    expect(parseCosListing("<Contents><Key>a&amp;b.png</Key><Size>1</Size></Contents>")).toEqual([
      { key: "a&b.png", sizeBytes: 1 },
    ]);
  });
});

describe("credentials", () => {
  it("uses a static pair when one is configured", async () => {
    const provider = createCredentialProvider(CONFIG, STATIC_ENV);
    expect(await provider()).toMatchObject({ secretId: "AKIDstatic", expiresAtMs: null });
  });

  it("reads the CVM instance role, and sends its token on every request", async () => {
    const role = { ...CONFIG, camRole: "dpsbuddy-app" };
    const { fetchImpl, calls } = stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          TmpSecretId: "AKIDtmp",
          TmpSecretKey: "tmp-key",
          Token: "session-token",
          ExpiredTime: 1_700_003_600,
          Code: "Success",
        }),
      },
      { status: 200 },
    ]);
    const store = createCosObjectStore({ config: role, env: {}, fetchImpl, now: () => 1_700_000_000_000 });
    await store.put(A, KEY_A, new Uint8Array(1), "image/png");

    expect(calls[0]?.url).toBe(
      "http://metadata.tencentyunapi.com/latest/meta-data/cam/security-credentials/dpsbuddy-app",
    );
    expect(calls[1]?.headers["x-cos-security-token"]).toBe("session-token");
    expect(authOf(calls[1] as Call)["q-ak"]).toBe("AKIDtmp");
  });

  it("asks the metadata service once for a burst, not once per upload", async () => {
    const role = { ...CONFIG, camRole: "dpsbuddy-app" };
    const { fetchImpl, calls } = stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          TmpSecretId: "AKIDtmp",
          TmpSecretKey: "tmp-key",
          Token: "t",
          ExpiredTime: 1_700_003_600,
          Code: "Success",
        }),
      },
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ]);
    const store = createCosObjectStore({ config: role, env: {}, fetchImpl, now: () => 1_700_000_000_000 });
    await Promise.all([
      store.put(A, `${KEY_A}.1`, new Uint8Array(1), "image/png"),
      store.put(A, `${KEY_A}.2`, new Uint8Array(1), "image/png"),
      store.put(A, `${KEY_A}.3`, new Uint8Array(1), "image/png"),
    ]);
    // The metadata service rate-limits. One refresh, three uploads.
    expect(calls.filter((call) => call.url.includes("security-credentials"))).toHaveLength(1);
  });

  it("refuses to sign anything when the role hands back a failure", async () => {
    const role = { ...CONFIG, camRole: "dpsbuddy-app" };
    const { fetchImpl } = stubFetch([{ status: 200, body: JSON.stringify({ Code: "Failed" }) }]);
    const store = createCosObjectStore({ config: role, env: {}, fetchImpl, now: () => 1 });
    await expect(store.read(A, KEY_A)).rejects.toMatchObject({ code: "storage_credentials_unavailable" });
  });

  it("refuses at construction when neither path is configured", () => {
    expect(() => createCredentialProvider(CONFIG, {})).toThrow(/COS_SECRET_ID|COS_CAM_ROLE/);
  });
});

describe("configuration", () => {
  it("builds the standard endpoint from the bucket and the region", () => {
    const config = cosConfigFromEnv({ COS_MEDIA_BUCKET: "b-123", TENCENT_REGION: "ap-jakarta" } as NodeJS.ProcessEnv);
    expect(config.endpoint).toBe("https://b-123.cos.ap-jakarta.myqcloud.com");
  });

  it("names what is missing rather than failing later at the first upload", () => {
    expect(() => cosConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/COS_MEDIA_BUCKET/);
    expect(() => cosConfigFromEnv({ COS_MEDIA_BUCKET: "b" } as NodeJS.ProcessEnv)).toThrow(/TENCENT_REGION/);
  });

  it("refuses a cleartext endpoint", () => {
    // The signature is a bearer credential for its window and the bucket holds tenants' uploads.
    expect(() =>
      cosConfigFromEnv({
        COS_MEDIA_BUCKET: "b",
        TENCENT_REGION: "r",
        COS_ENDPOINT: "http://b.example.com",
      } as NodeJS.ProcessEnv),
    ).toThrow(/https/);
  });
});

/**
 * Purging a prefix, and what a purge that fails half way is allowed to claim.
 *
 * The walk is not atomic — it is a DELETE per key and a bucket can refuse at any point — so the
 * honest answer to a partial failure is "run it again". What it must not do is report the failure
 * as though nothing had gone: the reset's audit row is the only record of a failed reset, and
 * `bytesFreed: 0` after two objects were deleted is the one number an operator would read to decide
 * whether a retry is safe.
 */
describe("purging a tenant's prefix", () => {
  const page = (entries: Array<[string, number]>, truncated: boolean, nextMarker?: string): string =>
    `<ListBucketResult>${entries
      .map(([key, size]) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`)
      .join(
        "",
      )}<IsTruncated>${truncated}</IsTruncated>${nextMarker ? `<NextMarker>${nextMarker}</NextMarker>` : ""}</ListBucketResult>`;

  it("deletes every owned key and reports what went", async () => {
    const { store, calls } = storeWith([
      {
        status: 200,
        body: page(
          [
            [`tenants/${A}/org/a.png`, 100],
            [`tenants/${A}/org/b.png`, 250],
          ],
          false,
        ),
      },
      { status: 204 },
      { status: 204 },
    ]);
    expect(await store.removePrefix(A)).toEqual({ usedBytes: 350, objectCount: 2 });
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
  });

  it("carries out what it had already deleted when the bucket refuses half way", async () => {
    const { store } = storeWith([
      {
        status: 200,
        body: page(
          [
            [`tenants/${A}/org/a.png`, 100],
            [`tenants/${A}/org/b.png`, 250],
            [`tenants/${A}/org/c.png`, 500],
          ],
          false,
        ),
      },
      { status: 204 },
      { status: 204 },
      { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" },
    ]);

    const error = await store.removePrefix(A).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).not.toBeNull();
    // Two objects really are gone, and the error says so rather than leaving the caller to assume
    // nothing happened.
    expect(purgeProgressOf(error)).toEqual({ usedBytes: 350, objectCount: 2 });
  });

  it("carries a zero rather than nothing when it fails on the listing itself", async () => {
    const { store } = storeWith([{ status: 500, body: "<Error><Code>InternalError</Code></Error>" }]);
    const error = await store.removePrefix(A).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(purgeProgressOf(error)).toEqual({ usedBytes: 0, objectCount: 0 });
  });

  it("refuses the local tenant, whose prefix is the whole bucket", async () => {
    const { store, calls } = storeWith([]);
    await expect(store.removePrefix(LOCAL_TENANT_ID)).rejects.toMatchObject({ code: "storage_purge_refused" });
    expect(calls).toHaveLength(0);
  });
});
