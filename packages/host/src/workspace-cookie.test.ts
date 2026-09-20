import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.AGENTFORGE_DATA_DIR = mkdtempSync(join(tmpdir(), "agentforge-workspace-cookie-"));

const { workspaceCookie, WORKSPACE_COOKIE } = await import("./workspace");

/**
 * A02-3. The desk cookie was the only cookie in the codebase that never carried `Secure`, while
 * the session (`auth/session.ts`) and CSRF (`csrf.ts`) cookies both do. HSTS makes a cleartext
 * request unlikely rather than impossible — the first navigation to a host, before the HSTS entry
 * exists, is the gap.
 */
describe("the workspace cookie", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.AGENTFORGE_SERVER;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.AGENTFORGE_SERVER;
    } else {
      process.env.AGENTFORGE_SERVER = saved;
    }
  });

  it("is Secure on the hosted server", () => {
    process.env.AGENTFORGE_SERVER = "1";
    expect(workspaceCookie("ws-1")).toEqual({
      name: WORKSPACE_COOKIE,
      value: "ws-1",
      path: "/",
      secure: true,
    });
  });

  it("is not Secure off server mode, where webdev and the desktop speak plain http", () => {
    delete process.env.AGENTFORGE_SERVER;
    expect(workspaceCookie("ws-1").secure).toBe(false);
  });

  it("reads the flag at call time rather than at import, so one process can be both", () => {
    delete process.env.AGENTFORGE_SERVER;
    expect(workspaceCookie("a").secure).toBe(false);
    process.env.AGENTFORGE_SERVER = "1";
    expect(workspaceCookie("a").secure).toBe(true);
  });

  it("scopes to the whole site, so a desk switch is not shadowed by a path-scoped copy", () => {
    expect(workspaceCookie("ws-9").path).toBe("/");
  });
});
