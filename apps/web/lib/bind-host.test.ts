import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOOPBACK_BIND_HOST, resolveBindHost } from "./bind-host";

/**
 * The other half of "what this listener tells the world about itself". Express stamps
 * `X-Powered-By: Express` from its own init middleware, before any handler runs, so the only place
 * it can be switched off is the app object in server.ts. Nothing can assert that without starting a
 * server, and this suite starts nothing, so the guard reads the source: it fails the moment someone
 * deletes the line.
 */
const serverSource = readFileSync(fileURLToPath(new URL("../server.ts", import.meta.url)), "utf8");

describe("apps/web/server.ts identity masking", () => {
  it("disables the Express X-Powered-By header on the app", () => {
    expect(serverSource).toContain('app.disable("x-powered-by")');
  });

  it("disables it before the first middleware is mounted", () => {
    expect(serverSource.indexOf('app.disable("x-powered-by")')).toBeLessThan(serverSource.indexOf("app.use("));
  });

  it("never sets a Server header of its own", () => {
    expect(serverSource).not.toMatch(/setHeader\(\s*["']Server["']/i);
  });
});

describe("resolveBindHost", () => {
  it("binds loopback when BIND_HOST is unset, empty or blank", () => {
    expect(resolveBindHost({})).toBe(LOOPBACK_BIND_HOST);
    expect(resolveBindHost({ BIND_HOST: "" })).toBe(LOOPBACK_BIND_HOST);
    expect(resolveBindHost({ BIND_HOST: "   " })).toBe(LOOPBACK_BIND_HOST);
    expect(LOOPBACK_BIND_HOST).toBe("127.0.0.1");
  });

  it("accepts an explicit loopback bind with no server mode", () => {
    expect(resolveBindHost({ BIND_HOST: "127.0.0.1" })).toBe("127.0.0.1");
    expect(resolveBindHost({ BIND_HOST: "localhost" })).toBe("localhost");
    expect(resolveBindHost({ BIND_HOST: " ::1 " })).toBe("::1");
  });

  it("refuses a non-loopback bind unless server mode is on", () => {
    expect(() => resolveBindHost({ BIND_HOST: "0.0.0.0" })).toThrow(/AGENTFORGE_SERVER/);
    expect(() => resolveBindHost({ BIND_HOST: "0.0.0.0" })).toThrow(/0\.0\.0\.0/);
    expect(() => resolveBindHost({ BIND_HOST: "::" })).toThrow();
    expect(() => resolveBindHost({ BIND_HOST: "192.168.1.10" })).toThrow();
  });

  it("allows the LAN bind the hosted container needs when server mode is on", () => {
    expect(resolveBindHost({ BIND_HOST: "0.0.0.0", AGENTFORGE_SERVER: "1" })).toBe("0.0.0.0");
    expect(resolveBindHost({ BIND_HOST: "::", AGENTFORGE_SERVER: "true" })).toBe("::");
  });

  it("still refuses when the server flag is set to something falsy", () => {
    expect(() => resolveBindHost({ BIND_HOST: "0.0.0.0", AGENTFORGE_SERVER: "0" })).toThrow();
    expect(() => resolveBindHost({ BIND_HOST: "0.0.0.0", AGENTFORGE_SERVER: "no" })).toThrow();
  });
});
