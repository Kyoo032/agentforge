import { describe, expect, it } from "vitest";
import {
  ALLOWED_BODY_CONTENT_TYPES,
  ALLOWED_METHODS,
  MAX_HEADER_BYTES,
  MAX_QUERY_PARAMS,
  MAX_REQUEST_PATH_LENGTH,
  filterHttpRequest,
  isAllowedMethod,
  isAllowedMutatingApiRequest,
  isAllowedWebHostHeader,
  isAllowedWebOrigin,
  isLocalRequestHost,
  isLocalRequestUrl,
  isLoopbackHostHeader,
} from "./local-request";

describe("isLocalRequestHost", () => {
  it("allows localhost and 127.0.0.1", () => {
    expect(isLocalRequestHost("localhost")).toBe(true);
    expect(isLocalRequestHost("127.0.0.1")).toBe(true);
    expect(isLocalRequestHost("LOCALHOST")).toBe(true);
    expect(isLocalRequestHost("::1")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLocalRequestHost("example.com")).toBe(false);
    expect(isLocalRequestHost("localhost.evil.com")).toBe(false);
    expect(isLocalRequestHost("127.0.0.1.attacker.test")).toBe(false);
    expect(isLocalRequestHost("")).toBe(false);
    expect(isLocalRequestHost(null)).toBe(false);
  });
});

describe("isLocalRequestUrl", () => {
  it("reads the host from Origin and Referer URLs", () => {
    expect(isLocalRequestUrl("http://localhost:3000")).toBe(true);
    expect(isLocalRequestUrl("http://127.0.0.1:3000/settings")).toBe(true);
    expect(isLocalRequestUrl("https://evil.example")).toBe(false);
  });
});

describe("isLoopbackHostHeader", () => {
  it("accepts loopback names with or without a port", () => {
    expect(isLoopbackHostHeader("localhost")).toBe(true);
    expect(isLoopbackHostHeader("localhost:3000")).toBe(true);
    expect(isLoopbackHostHeader("127.0.0.1")).toBe(true);
    expect(isLoopbackHostHeader("127.0.0.1:3100")).toBe(true);
    expect(isLoopbackHostHeader("[::1]")).toBe(true);
    expect(isLoopbackHostHeader("[::1]:3000")).toBe(true);
    expect(isLoopbackHostHeader("::1")).toBe(true);
    expect(isLoopbackHostHeader(" LocalHost:3000 ")).toBe(true);
  });

  it("rejects every other host", () => {
    expect(isLoopbackHostHeader("example.com")).toBe(false);
    expect(isLoopbackHostHeader("example.com:3000")).toBe(false);
    expect(isLoopbackHostHeader("localhost.evil.com")).toBe(false);
    expect(isLoopbackHostHeader("127.0.0.1.attacker.test")).toBe(false);
    expect(isLoopbackHostHeader("192.168.1.10:3000")).toBe(false);
    expect(isLoopbackHostHeader("[::1].evil.com")).toBe(false);
    expect(isLoopbackHostHeader("localhost:3000:evil")).toBe(false);
  });

  it("rejects a missing Host header, unlike a missing Origin", () => {
    expect(isLoopbackHostHeader(null)).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
    expect(isLoopbackHostHeader("")).toBe(false);
    expect(isLoopbackHostHeader("   ")).toBe(false);
  });
});

describe("isAllowedMutatingApiRequest", () => {
  it("allows missing Origin as same-machine", () => {
    expect(isAllowedMutatingApiRequest(null)).toBe(true);
    expect(isAllowedMutatingApiRequest(undefined)).toBe(true);
    expect(isAllowedMutatingApiRequest("")).toBe(true);
    expect(isAllowedMutatingApiRequest(null, "https://evil.example/")).toBe(true);
  });

  it("allows local Origin hosts", () => {
    expect(isAllowedMutatingApiRequest("http://localhost:3000")).toBe(true);
    expect(isAllowedMutatingApiRequest("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects a remote Origin", () => {
    expect(isAllowedMutatingApiRequest("https://evil.example")).toBe(false);
    expect(isAllowedMutatingApiRequest("https://evil.example", "http://localhost:3000")).toBe(false);
  });
});

const WEB_ALLOWLIST = ["https://app.dpsbuddy.com", "http://127.0.0.1:3000"] as const;

describe("isAllowedWebOrigin", () => {
  it("allows an Origin that is on the allowlist, whatever its case", () => {
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebOrigin("HTTPS://APP.DPSBUDDY.COM", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebOrigin("http://127.0.0.1:3000", WEB_ALLOWLIST)).toBe(true);
  });

  it("rejects a missing Origin, unlike the loopback rule", () => {
    expect(isAllowedWebOrigin(null, WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin(undefined, WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("   ", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedMutatingApiRequest(null)).toBe(true);
  });

  it("rejects an unlisted origin, a different scheme and a different port", () => {
    expect(isAllowedWebOrigin("https://evil.example", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("http://app.dpsbuddy.com", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("http://127.0.0.1:3100", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com.evil.test", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebOrigin("null", WEB_ALLOWLIST)).toBe(false);
  });

  it("rejects everything when the allowlist is empty (an unconfigured server)", () => {
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com", [])).toBe(false);
  });

  it("accepts an Origin that spells out the scheme's default port the allowlist omits", () => {
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com:443", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebOrigin("http://app.dpsbuddy.com:80", ["http://app.dpsbuddy.com"])).toBe(true);
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com", ["https://app.dpsbuddy.com:443"])).toBe(true);
  });

  it("rejects a trailing-dot Origin host, which is not the name on the certificate", () => {
    expect(isAllowedWebOrigin("https://app.dpsbuddy.com.", WEB_ALLOWLIST)).toBe(false);
  });
});

describe("isAllowedWebHostHeader", () => {
  it("accepts the host of a trusted origin, with or without its default port", () => {
    expect(isAllowedWebHostHeader("app.dpsbuddy.com", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebHostHeader("app.dpsbuddy.com:443", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebHostHeader(" APP.DPSBUDDY.COM ", WEB_ALLOWLIST)).toBe(true);
    expect(isAllowedWebHostHeader("127.0.0.1:3000", WEB_ALLOWLIST)).toBe(true);
  });

  it("rejects a Host that is not one of the trusted origins", () => {
    expect(isAllowedWebHostHeader("attacker.example", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("app.dpsbuddy.com:8443", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("127.0.0.1", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("127.0.0.1:3100", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("app.dpsbuddy.com.evil.test", WEB_ALLOWLIST)).toBe(false);
  });

  it("rejects a missing Host and an empty allowlist", () => {
    expect(isAllowedWebHostHeader(null, WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("app.dpsbuddy.com", [])).toBe(false);
  });

  it("accepts the bracketed IPv6 loopback when it is a trusted origin", () => {
    expect(isAllowedWebHostHeader("[::1]:3000", ["http://[::1]:3000"])).toBe(true);
  });

  it("rejects a trailing-dot Host, the absolute DNS spelling of the same name", () => {
    expect(isAllowedWebHostHeader("app.dpsbuddy.com.", WEB_ALLOWLIST)).toBe(false);
    expect(isAllowedWebHostHeader("app.dpsbuddy.com.:443", WEB_ALLOWLIST)).toBe(false);
  });
});

const FILTER_MAX_BODY = 1024;
const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const NEWLINE = String.fromCharCode(10);
const DEL = String.fromCharCode(127);

function filter(overrides: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}): { status: number; code: string; message: string } | null {
  return filterHttpRequest({
    method: overrides.method ?? "GET",
    url: overrides.url ?? "/api/v1/chat",
    headers: overrides.headers ?? {},
    maxBodyBytes: FILTER_MAX_BODY,
  });
}

describe("isAllowedMethod", () => {
  it("allows the seven verbs the app speaks", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(isAllowedMethod(method)).toBe(true);
    }
    expect(ALLOWED_METHODS.size).toBe(7);
  });

  it("refuses the debug and tunnel verbs", () => {
    for (const method of ["TRACE", "TRACK", "CONNECT", "PROPFIND", "SEARCH", ""]) {
      expect(isAllowedMethod(method)).toBe(false);
    }
  });

  it("is case sensitive: the adapter upper-cases before it asks", () => {
    expect(isAllowedMethod("get")).toBe(false);
  });
});

describe("filterHttpRequest method allowlist", () => {
  it("answers 405 method_not_allowed for the verbs outside the list", () => {
    expect(filter({ method: "TRACE" })).toMatchObject({ status: 405, code: "method_not_allowed" });
    expect(filter({ method: "CONNECT" })).toMatchObject({ status: 405, code: "method_not_allowed" });
  });

  it("lets an allowed verb through", () => {
    expect(filter({ method: "POST", url: "/api/v1/chat" })).toBeNull();
  });
});

describe("filterHttpRequest path filter", () => {
  it("refuses a NUL byte, raw or encoded", () => {
    expect(filter({ url: `/api/v1/chat${NUL}` })).toMatchObject({ status: 400, code: "invalid_path" });
    expect(filter({ url: "/api/v1/chat%00" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/v1/chat%2500" })).toBeNull();
  });

  it("refuses other control characters", () => {
    expect(filter({ url: `/api/v1/ch${BELL}at` })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: `/api/v1/ch${NEWLINE}at` })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: `/api/v1/ch${DEL}at` })).toMatchObject({ code: "invalid_path" });
  });

  it("refuses a dot-dot segment, however it is spelled", () => {
    expect(filter({ url: "/api/../etc/passwd" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/v1/..%2fsecret" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/%2e%2e/secret" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/%2E./secret" })).toMatchObject({ code: "invalid_path" });
  });

  it("keeps a dot that is part of a name", () => {
    expect(filter({ url: "/api/v1/artifacts/report..final.docx" })).toBeNull();
    expect(filter({ url: "/api/v1/artifacts/./a" })).toBeNull();
  });

  it("refuses a backslash and an encoded slash in the path", () => {
    expect(filter({ url: "/api/v1/chat\\x" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/v1%2fchat" })).toMatchObject({ code: "invalid_path" });
    expect(filter({ url: "/api/v1%5Cchat" })).toMatchObject({ code: "invalid_path" });
  });

  it("leaves an encoded slash in a QUERY value alone, which is an ordinary parameter", () => {
    expect(filter({ url: "/api/v1/chat?next=https%3A%2F%2Fapp.example.com%2Fx" })).toBeNull();
  });

  it("refuses a path longer than the cap", () => {
    const long = `/api/v1/${"a".repeat(MAX_REQUEST_PATH_LENGTH)}`;
    expect(long.length).toBeGreaterThan(MAX_REQUEST_PATH_LENGTH);
    expect(filter({ url: long })).toMatchObject({ status: 400, code: "invalid_path" });
    expect(filter({ url: `/${"a".repeat(MAX_REQUEST_PATH_LENGTH - 1)}` })).toBeNull();
  });
});

describe("filterHttpRequest query filter", () => {
  it("refuses more than the cap of query parameters", () => {
    const many = Array.from({ length: MAX_QUERY_PARAMS + 1 }, (_, i) => `k${i}=1`).join("&");
    expect(filter({ url: `/api/v1/chat?${many}` })).toMatchObject({ status: 400, code: "too_many_query_params" });
  });

  it("allows exactly the cap", () => {
    const many = Array.from({ length: MAX_QUERY_PARAMS }, (_, i) => `k${i}=1`).join("&");
    expect(filter({ url: `/api/v1/chat?${many}` })).toBeNull();
  });
});

describe("filterHttpRequest header size filter", () => {
  it("refuses a single header past 8 KB", () => {
    expect(MAX_HEADER_BYTES).toBe(8 * 1024);
    expect(filter({ headers: { cookie: "x".repeat(MAX_HEADER_BYTES + 1) } })).toMatchObject({
      status: 431,
      code: "header_too_large",
    });
  });

  it("counts the name as well as the value, and every value of a repeated header", () => {
    expect(filter({ headers: { cookie: "x".repeat(MAX_HEADER_BYTES - 2) } })).toMatchObject({
      code: "header_too_large",
    });
    expect(filter({ headers: { "set-cookie": ["a", "x".repeat(MAX_HEADER_BYTES)] } })).toMatchObject({
      code: "header_too_large",
    });
  });

  it("lets ordinary headers through", () => {
    expect(filter({ headers: { cookie: "a=1; b=2", origin: "https://app.example.com" } })).toBeNull();
  });
});

describe("filterHttpRequest body size filter", () => {
  it("refuses a Content-Length above the cap before any byte is read", () => {
    const headers = { "content-length": String(FILTER_MAX_BODY + 1), "content-type": "application/json" };
    expect(filter({ method: "POST", headers })).toMatchObject({ status: 413, code: "payload_too_large" });
  });

  it("allows a Content-Length exactly at the cap", () => {
    const headers = { "content-length": String(FILTER_MAX_BODY), "content-type": "application/json" };
    expect(filter({ method: "POST", headers })).toBeNull();
  });

  it("ignores a Content-Length that is not a number", () => {
    expect(filter({ method: "POST", headers: { "content-length": "many" } })).toBeNull();
  });
});

describe("filterHttpRequest content type allowlist", () => {
  it("allows json, multipart and text/plain", () => {
    expect(ALLOWED_BODY_CONTENT_TYPES).toEqual(["application/json", "multipart/form-data", "text/plain"]);
    for (const type of [
      "application/json",
      "application/json; charset=utf-8",
      "multipart/form-data; boundary=abc",
      "text/plain",
      "TEXT/PLAIN; charset=UTF-8",
    ]) {
      expect(filter({ method: "POST", headers: { "content-type": type, "content-length": "10" } })).toBeNull();
    }
  });

  it("refuses a form post, the classic cross-site shape", () => {
    const headers = { "content-type": "application/x-www-form-urlencoded", "content-length": "10" };
    expect(filter({ method: "POST", headers })).toMatchObject({ status: 415, code: "unsupported_media_type" });
  });

  it("refuses a declared body with no Content-Type at all", () => {
    expect(filter({ method: "POST", headers: { "content-length": "10" } })).toMatchObject({
      code: "unsupported_media_type",
    });
    expect(filter({ method: "POST", headers: { "transfer-encoding": "chunked" } })).toMatchObject({
      code: "unsupported_media_type",
    });
  });

  it("does not ask a bodyless request for a Content-Type", () => {
    expect(filter({ method: "POST" })).toBeNull();
    expect(filter({ method: "DELETE", headers: { "content-length": "0" } })).toBeNull();
    expect(filter({ method: "GET", headers: { "content-type": "application/x-www-form-urlencoded" } })).toBeNull();
  });

  it("still refuses a disallowed Content-Type on a mutating request with no declared length", () => {
    expect(filter({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } })).toMatchObject({
      code: "unsupported_media_type",
    });
  });

  it("never puts the offending value in the message, which is fixed text", () => {
    const headers = { "content-type": "application/x-secret", "content-length": "3" };
    const rejection = filter({ method: "POST", headers });
    expect(rejection?.message).not.toContain("x-secret");
    expect(rejection?.message.length).toBeGreaterThan(0);
  });
});
