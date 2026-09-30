import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { EvalRefusal, GatewayCredentials, loadGatewayCredentials, requireDataDir, requireEvalDesk } from "./credentials";

const KEY = "sk-live-abcdef0123456789-do-not-print";

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "ai", ...extra };
}

describe("requireDataDir", () => {
  it("wants a desk named, and lets a stub runtime through: reading a saved cache calls nothing", () => {
    expect(requireDataDir(env()).dataDir).toContain("desk");
    expect(requireDataDir(env({ AGENTFORGE_RUNTIME: "stub" })).dataDir).toContain("desk");
    expect(() => requireDataDir(env({ AGENTFORGE_DATA_DIR: undefined }))).toThrow(/AGENTFORGE_DATA_DIR/);
  });
});

describe("requireEvalDesk", () => {
  it("returns the data dir it was pointed at", () => {
    expect(requireEvalDesk(env()).dataDir).toContain("desk");
  });

  it("refuses the stub runtime, whatever the spelling", () => {
    expect(() => requireEvalDesk(env({ AGENTFORGE_RUNTIME: "stub" }))).toThrow(EvalRefusal);
    expect(() => requireEvalDesk(env({ AGENTFORGE_RUNTIME: " STUB " }))).toThrow(/stub/);
  });

  it("refuses to guess a desk: no AGENTFORGE_DATA_DIR is no run", () => {
    expect(() => requireEvalDesk(env({ AGENTFORGE_DATA_DIR: undefined }))).toThrow(/AGENTFORGE_DATA_DIR/);
    expect(() => requireEvalDesk(env({ AGENTFORGE_DATA_DIR: "  " }))).toThrow(/AGENTFORGE_DATA_DIR/);
  });

  it("leaves the runtime alone when it is unset or ai", () => {
    expect(() => requireEvalDesk(env({ AGENTFORGE_RUNTIME: undefined }))).not.toThrow();
    expect(() => requireEvalDesk(env({ AGENTFORGE_RUNTIME: "ai" }))).not.toThrow();
  });
});

describe("loadGatewayCredentials", () => {
  it("reads the saved key through the settings loader it is given, for the desk it names", () => {
    const seen: Array<string | undefined> = [];
    const credentials = loadGatewayCredentials({
      env: env(),
      workspace: "desk-7",
      loadSettings: (workspace) => {
        seen.push(workspace);
        return { openaiApiKey: KEY };
      },
    });
    expect(seen).toEqual(["desk-7"]);
    expect(credentials.baseUrl).toMatch(/^https:\/\//);
    expect(credentials.authHeaders("chat_completions")).toEqual({ Authorization: `Bearer ${KEY}` });
  });

  it("refuses when the desk has no saved key", () => {
    expect(() => loadGatewayCredentials({ env: env(), loadSettings: () => ({}) })).toThrow(EvalRefusal);
    expect(() => loadGatewayCredentials({ env: env(), loadSettings: () => ({ openaiApiKey: "  " }) })).toThrow(/no gateway key/i);
  });

  it("does not fall back to a key from the environment: the saved one or nothing", () => {
    expect(() =>
      loadGatewayCredentials({ env: env({ OPENAI_API_KEY: KEY }), loadSettings: () => ({}) }),
    ).toThrow(/no gateway key/i);
  });

  it("refuses the stub runtime before it reads any settings", () => {
    let read = false;
    expect(() =>
      loadGatewayCredentials({
        env: env({ AGENTFORGE_RUNTIME: "stub" }),
        loadSettings: () => {
          read = true;
          return { openaiApiKey: KEY };
        },
      }),
    ).toThrow(EvalRefusal);
    expect(read).toBe(false);
  });

  it("names neither the key nor a fragment of it in a refusal", () => {
    try {
      loadGatewayCredentials({ env: env({ AGENTFORGE_RUNTIME: "stub", OPENAI_API_KEY: KEY }), loadSettings: () => ({}) });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("sk-live");
    }
  });
});

describe("GatewayCredentials never gives the key away by accident", () => {
  const credentials = new GatewayCredentials(KEY, "https://api.example.test/v1");

  it("serialises to the host and nothing else", () => {
    const text = JSON.stringify(credentials);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("sk-live");
    expect(text).toContain("api.example.test");
  });

  it("prints as redacted through util.inspect and console.log", () => {
    expect(inspect(credentials)).not.toContain("sk-live");
    expect(String(credentials)).not.toContain("sk-live");
    expect(`${credentials}`).not.toContain("sk-live");
  });

  it("has no enumerable field that holds the key", () => {
    for (const value of Object.values(credentials)) {
      expect(String(value)).not.toContain("sk-live");
    }
  });

  it("hands the key only to a function that asks for it, and returns what that function returns", () => {
    expect(credentials.withKey((key) => key.length)).toBe(KEY.length);
    expect(credentials.withKey(() => "answer")).toBe("answer");
  });

  it("scrubs the key out of any text it is asked to redact, and out of a message that echoes it", () => {
    expect(credentials.redact(`Incorrect API key provided: ${KEY}.`)).not.toContain(KEY);
    expect(credentials.redact(`Incorrect API key provided: ${KEY}.`)).toContain("[key]");
    expect(credentials.redact("nothing secret here")).toBe("nothing secret here");
  });

  it("writes each wire's own header", () => {
    expect(credentials.authHeaders("anthropic_messages")).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
    });
    expect(credentials.authHeaders("google_generate_content")).toEqual({ "x-goog-api-key": KEY });
    expect(credentials.authHeaders("responses")).toEqual({ Authorization: `Bearer ${KEY}` });
  });

  it("refuses an endpoint the host itself would refuse", () => {
    expect(() => new GatewayCredentials(KEY, "http://gateway.example.test/v1")).toThrow();
    expect(() => new GatewayCredentials(KEY, "")).toThrow();
  });
});
