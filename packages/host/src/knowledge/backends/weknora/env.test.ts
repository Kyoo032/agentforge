import { describe, expect, it } from "vitest";
import { FORBIDDEN_ENV_KEYS, INHERITED_ENV_KEYS, sidecarEnv, sidecarPaths } from "./env";

/**
 * The sidecar's environment is the trust boundary: WeKnora is an OpenAI-compatible client that
 * reads `OPENAI_API_KEY` / `OPENAI_BASE_URL` straight from the environment, so an inherited
 * `process.env` would hand a bundled third-party binary the owner's gateway key. These assertions
 * are the guard on that, not documentation of it.
 */

const BASE = {
  port: 41234,
  dataDir: "/tmp/desk/weknora",
  aesKey: "0123456789abcdef0123456789abcdef",
  jwtSecret: "jwt-secret",
};

function envWithSecrets(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin",
    TEMP: "/tmp",
    OPENAI_API_KEY: "sk-live-secret",
    OPENAI_BASE_URL: "https://api.tokotokenai.com/v1",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    AGENTFORGE_SECRETS_KEY: "master",
    DATABASE_URL: "file:/desk/agentforge.sqlite",
    LANGFUSE_PUBLIC_KEY: "pk-lf",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  };
}

describe("weknora sidecar environment", () => {
  it("never passes a provider key or any other inherited secret", () => {
    const env = sidecarEnv({ ...BASE, parent: envWithSecrets() });
    for (const key of FORBIDDEN_ENV_KEYS) {
      expect(env[key], `${key} must not reach the sidecar`).toBeUndefined();
    }
  });

  it("passes only allowlisted variables from the parent process", () => {
    const parent: NodeJS.ProcessEnv = { ...envWithSecrets(), SOMETHING_ELSE: "nope" };
    const env = sidecarEnv({ ...BASE, parent });
    const inheritedNames = new Set<string>(INHERITED_ENV_KEYS);
    const fromParent = Object.keys(env).filter((key) => parent[key] !== undefined && env[key] === parent[key]);
    for (const key of fromParent) {
      expect(inheritedNames.has(key), `${key} was inherited but is not on the allowlist`).toBe(true);
    }
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SOMETHING_ELSE).toBeUndefined();
  });

  it("binds the port and host we chose, on loopback", () => {
    const env = sidecarEnv({ ...BASE, parent: {} });
    expect(env.SERVER_PORT).toBe("41234");
    expect(env.SERVER_HOST).toBe("127.0.0.1");
  });

  it("points storage at our data dir and turns every external service off", () => {
    const env = sidecarEnv({ ...BASE, parent: {} });
    const paths = sidecarPaths(BASE.dataDir);
    expect(env.DB_DRIVER).toBe("sqlite");
    expect(env.DB_PATH).toBe(paths.db);
    expect(env.LOCAL_STORAGE_BASE_DIR).toBe(paths.files);
    expect(env.RETRIEVE_DRIVER).toBe("sqlite");
    expect(env.STORAGE_TYPE).toBe("local");
    expect(env.STREAM_MANAGER_TYPE).toBe("memory");
    // Empty string, not absent: it is how WeKnora is told the service does not exist.
    expect(env.REDIS_ADDR).toBe("");
    expect(env.DOCREADER_ADDR).toBe("");
    expect(env.NEO4J_ENABLE).toBe("false");
    expect(env.ENABLE_GRAPH_RAG).toBe("false");
    expect(env.WEKNORA_SANDBOX_MODE).toBe("disabled");
  });

  it("stays offline and refuses new registrations", () => {
    const env = sidecarEnv({ ...BASE, parent: {} });
    // Without this DuckDB runs `INSTALL spatial` against extensions.duckdb.org at startup.
    expect(env.DUCKDB_SKIP_EXTENSION_LOAD).toBe("1");
    expect(env.DISABLE_REGISTRATION).toBe("true");
    expect(env.GIN_MODE).toBe("release");
    expect(env.LOG_LEVEL).toBe("warn");
  });

  it("carries the 32-character AES key under both the live and the deprecated name", () => {
    const env = sidecarEnv({ ...BASE, parent: {} });
    expect(BASE.aesKey).toHaveLength(32);
    expect(env.SYSTEM_AES_KEY).toBe(BASE.aesKey);
    expect(env.TENANT_AES_KEY).toBe(BASE.aesKey);
    expect(env.JWT_SECRET).toBe(BASE.jwtSecret);
  });

  it("does not mutate the parent environment it was given", () => {
    const parent = envWithSecrets();
    const before = JSON.stringify(parent);
    sidecarEnv({ ...BASE, parent });
    expect(JSON.stringify(parent)).toBe(before);
  });
});
