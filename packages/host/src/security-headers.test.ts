import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
} from "./security-headers";

const caddyfile = readFileSync(fileURLToPath(new URL("../../../webapp-deploy/Caddyfile", import.meta.url)), "utf8");

function sink() {
  const written: Record<string, string> = {};
  return {
    written,
    setHeader(name: string, value: string) {
      written[name] = value;
    },
  };
}

/** `Header-Name "value"` in the Caddyfile's `header { … }` block. */
function caddyHeader(name: string): string | null {
  const match = caddyfile.match(new RegExp(`^\\s*${name}\\s+"([^"]*)"\\s*$`, "m"));
  return match ? match[1] : null;
}

describe("applySecurityHeaders", () => {
  it("writes the whole set in server mode", () => {
    const res = sink();
    applySecurityHeaders(res, true);
    expect(Object.keys(res.written).sort()).toEqual(
      [
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
    expect(res.written["X-Frame-Options"]).toBe("DENY");
    expect(res.written["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("writes nothing off server mode, so webdev and the desktop are untouched", () => {
    const res = sink();
    applySecurityHeaders(res, false);
    expect(res.written).toEqual({});
  });
});

describe("the policy forbids the things it exists to forbid", () => {
  it("allows no inline or remote script", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("blocks framing, plugins, foreign form posts and base-tag rewrites", () => {
    for (const directive of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "default-src 'self'",
    ]) {
      expect(CONTENT_SECURITY_POLICY, directive).toContain(directive);
    }
  });

  it("allows inline images only in the raster forms the renderer accepts, never svg", () => {
    // `apps/web/lib/renderable-media.ts` allows data:image/(png|jpeg|webp|gif) and rejects
    // svg+xml, which can carry script. The policy must not be looser than that gate.
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: blob:");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' data:");
  });

  /**
   * SR-14. The Meeting recorder asks for `getUserMedia` (microphone) and `getDisplayMedia`
   * (tab audio), so those two features are allowed for the app's own origin and nothing else.
   * The whole string is pinned rather than spot-checked: a third feature added by accident is a
   * silent widening of the hosted attack surface, and the Caddyfile parity test below compares the
   * same string at the proxy.
   */
  it("is exactly the policy the hosted deployment is meant to send", () => {
    expect(PERMISSIONS_POLICY).toBe(
      "accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(self), " +
        "encrypted-media=(), geolocation=(), gyroscope=(), interest-cohort=(), magnetometer=(), " +
        "microphone=(self), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), " +
        "serial=(), usb=(), xr-spatial-tracking=()",
    );
  });

  it("allows the two recorder features for this origin only", () => {
    for (const feature of ["microphone", "display-capture"]) {
      expect(PERMISSIONS_POLICY, feature).toContain(`${feature}=(self)`);
    }
    // `(self)` is the whole allowance: no wildcard, no named origin, no `src`, and no bare `*`
    // anywhere in the header. A cross-origin frame therefore inherits neither feature.
    expect(PERMISSIONS_POLICY).not.toMatch(/=\(\s*\*/);
    expect(PERMISSIONS_POLICY).not.toContain("*");
    expect(PERMISSIONS_POLICY).not.toContain("https://");
    expect(PERMISSIONS_POLICY).not.toContain("src");
  });

  it("still turns every other powerful feature off, one by one", () => {
    const allowed = new Set(["microphone", "display-capture"]);
    const entries = PERMISSIONS_POLICY.split(", ").map((entry) => {
      const [feature = "", value = ""] = entry.split("=");
      return { feature, value };
    });
    expect(entries.length).toBe(18);
    for (const { feature, value } of entries) {
      expect(value, feature).toBe(allowed.has(feature) ? "(self)" : "()");
    }
    // The ones this app must never ask for, named so a future edit has to argue with a test.
    for (const feature of [
      "accelerometer",
      "autoplay",
      "browsing-topics",
      "camera",
      "encrypted-media",
      "geolocation",
      "gyroscope",
      "interest-cohort",
      "magnetometer",
      "midi",
      "payment",
      "publickey-credentials-get",
      "screen-wake-lock",
      "serial",
      "usb",
      "xr-spatial-tracking",
    ]) {
      expect(PERMISSIONS_POLICY, feature).toContain(`${feature}=()`);
    }
  });

  /**
   * The recorder records; it does not fetch. Pinned here so a later CSP edit cannot quietly remove
   * what the recorder leans on, and so nobody widens the policy "for the recorder" when it needs
   * nothing more: `MediaRecorder` and `AudioContext` are not fetches and have no CSP directive,
   * and the upload is the same-origin `POST /api/v1/meetings/:id/recording`.
   */
  it("already carries what the meeting recorder needs, and needs nothing added for it", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("media-src 'self' blob:");
    expect(CONTENT_SECURITY_POLICY).toContain("worker-src 'self' blob:");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https://api.tokotokenai.com");
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  });

  it("asks for a year of HSTS and does not ask to be preloaded", () => {
    expect(STRICT_TRANSPORT_SECURITY).toContain("max-age=31536000");
    expect(STRICT_TRANSPORT_SECURITY).toContain("includeSubDomains");
    expect(STRICT_TRANSPORT_SECURITY).not.toContain("preload");
  });
});

/**
 * The app is the floor and the proxy is the ceiling, and the two are only useful if they say the
 * same thing. Caddy's `header` directive REPLACES rather than appends, so on the real deployment
 * the proxy's value is what goes out — which is exactly why a silent divergence would be invisible
 * until someone deployed behind a different proxy.
 */
describe("the app's headers and webapp-deploy/Caddyfile do not drift apart", () => {
  it("reads the Caddyfile this test is pinned against", () => {
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("agrees on every header the proxy also sets", () => {
    for (const name of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
    ] as const) {
      const fromProxy = caddyHeader(name);
      expect(fromProxy, `${name} is missing from the Caddyfile`).not.toBeNull();
      expect(fromProxy, name).toBe(SECURITY_HEADERS[name]);
    }
  });

  /**
   * SR-14 named this file as the thing that catches "changed one, forgot the other". The parity
   * test above compares the whole string, which already does that; this one says out loud which
   * two features the proxy has to be carrying, so a reader of the Caddyfile alone can see it.
   */
  it("carries the recorder allowance at the proxy as well as at the app", () => {
    const fromProxy = caddyHeader("Permissions-Policy") ?? "";
    expect(fromProxy).toContain("microphone=(self)");
    expect(fromProxy).toContain("display-capture=(self)");
    expect(fromProxy).toContain("camera=()");
    expect(fromProxy).not.toContain("*");
  });

  it("still has the proxy stripping the two identity headers", () => {
    expect(caddyfile).toMatch(/^\s*-Server\s*$/m);
    expect(caddyfile).toMatch(/^\s*-X-Powered-By\s*$/m);
  });
});
