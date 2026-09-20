/**
 * The two routes. Validation is asserted at the boundary (an id that is not in the manifest is a 400
 * before anything runs), and so is the deliberate absence of the gateway gate: these must answer
 * during onboarding, before a key exists.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-components-handler-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;

const { handleGetComponents, handlePostComponentInstallStream } = await import("./components");
const { collectJobEvents } = await import("../job-stream");
const { COMPONENT_IDS } = await import("../components/types");
type HostRequest = import("../types").HostRequest;

const HERE = fileURLToPath(new URL(".", import.meta.url));

function request(body: unknown): HostRequest {
  return {
    method: "POST",
    path: "/api/v1/components/install/stream",
    query: {},
    params: {},
    headers: {},
    body,
  };
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/v1/components", () => {
  it("answers { components: [...] } with one entry per manifest component", async () => {
    const result = await handleGetComponents(request(null));
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    const body = result.body as { components: Array<Record<string, unknown>> };
    expect(body.components).toHaveLength(COMPONENT_IDS.length);
    const [anydoc] = body.components;
    expect(Object.keys(anydoc).sort()).toEqual(["auto", "bytes", "id", "source", "state", "version"]);
    expect(anydoc).toMatchObject({ id: "anydoc", version: "0.2.4", auto: false });
    expect(["ready", "missing", "installing", "failed", "unsupported"]).toContain(anydoc.state);
  });
});

describe("POST /api/v1/components/install/stream", () => {
  it("rejects an unknown component id with 400 before anything runs", async () => {
    for (const body of [{ id: "ffmpeg" }, { id: "" }, {}, null, { id: 7 }]) {
      const result = await handlePostComponentInstallStream(request(body));
      expect(result.type).toBe("json");
      if (result.type === "json") {
        expect(result.status).toBe(400);
        expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
      }
    }
  });

  it("streams job events for a known id", async () => {
    // `auto` is false under vitest and the probe is the real one, so this either finds the module
    // already present (every stage skipped) or fails without a network — both end the stream.
    const result = await handlePostComponentInstallStream(request({ id: "anydoc" }));
    expect(result.type).toBe("stream");
    if (result.type !== "stream") {
      return;
    }
    const events = await collectJobEvents(result);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(["job.done", "job.error"]).toContain(last.type);
  });
});

describe("the component routes are not behind the gateway gate", () => {
  it("never calls requireGatewayAllowed — a component installs before a key exists", () => {
    // Comments are stripped first: the handler is free to *explain* the gate it must not apply.
    const source = readFileSync(join(HERE, "components.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    expect(source).not.toMatch(/requireGatewayAllowed\s*\(/);
    expect(source).not.toContain("gateway-gate");
  });

  it("is registered in the router without a gate", () => {
    const router = readFileSync(join(HERE, "..", "router.ts"), "utf8");
    expect(router).toContain('compile("GET", "/api/v1/components", handleGetComponents)');
    expect(router).toContain('compile("POST", "/api/v1/components/install/stream", handlePostComponentInstallStream)');
  });
});

/**
 * A01-5. The hosted image bakes anydoc in and `reportComponentStatus` resolves the bundled copy
 * first, so the download path is dead weight there — and it is the one thing keeping `/data` from
 * being mounted `noexec` (security spec H3). The env flag is safe to flip here because these
 * handlers are called directly rather than through the router, whose session gate it would arm.
 */
describe("POST /api/v1/components/install/stream in server mode", () => {
  async function installUnderServerMode(body: unknown) {
    const saved = process.env.AGENTFORGE_SERVER;
    process.env.AGENTFORGE_SERVER = "1";
    try {
      return await handlePostComponentInstallStream(request(body));
    } finally {
      if (saved === undefined) {
        delete process.env.AGENTFORGE_SERVER;
      } else {
        process.env.AGENTFORGE_SERVER = saved;
      }
    }
  }

  it("refuses a valid install with install_disabled and never opens a stream", async () => {
    const result = await installUnderServerMode({ id: "anydoc" });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: { code: "install_disabled" } });
    }
  });

  it("refuses before the body is even validated, so an unknown id is 403 and not 400", async () => {
    const result = await installUnderServerMode({ id: "not-a-component" });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(403);
    }
  });

  it("still installs off server mode, so the desktop and webdev are untouched", async () => {
    const result = await handlePostComponentInstallStream(request({ id: "anydoc" }));
    expect(result.type).toBe("stream");
  });
});
