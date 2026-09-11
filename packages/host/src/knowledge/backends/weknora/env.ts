import path from "node:path";

/**
 * The sidecar's environment, built from an explicit allowlist rather than inherited.
 *
 * WeKnora is an OpenAI-compatible client with its own model rows, and it reads `OPENAI_API_KEY`,
 * `OPENAI_BASE_URL`, `LANGFUSE_*` and friends straight out of the environment when they are there.
 * Inheriting `process.env` would hand a bundled third-party binary the owner's gateway key and let
 * it call out on its own account — so nothing crosses that line unless it is named here.
 *
 * Every key below is upstream's own (`.env.lite.example`, `internal/config/config.go`); the port
 * and host ride `SERVER_PORT` / `SERVER_HOST`, which viper's `AutomaticEnv` maps from the
 * `server.port` / `server.host` keys that `config/config.yaml` already declares.
 */

/**
 * Variables copied from the parent process. A child that cannot find its own temp directory or a
 * system DLL is a support ticket, so the OS basics travel; nothing that carries a credential does.
 */
export const INHERITED_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
] as const;

export type SidecarEnvInput = {
  port: number;
  /** `localDataDir()/weknora` — the sidecar owns everything under it and nothing outside it. */
  dataDir: string;
  /** 32-char key the sidecar encrypts its own stored model keys with. */
  aesKey: string;
  jwtSecret: string;
  /** Parent environment the OS basics are copied from. */
  parent?: NodeJS.ProcessEnv;
};

/** Where the sidecar's SQLite file and uploaded blobs live, under one directory we own. */
export function sidecarPaths(dataDir: string): { db: string; files: string; pidFile: string } {
  return {
    db: path.join(dataDir, "data", "weknora.db"),
    files: path.join(dataDir, "data", "files"),
    pidFile: path.join(dataDir, "sidecar.pid"),
  };
}

/**
 * The complete environment the sidecar is spawned with. Pure: it reads `input.parent` and returns a
 * new object, so a test can assert the absence of a key without touching `process.env`.
 *
 * The empty-string values are deliberate and not the same as absence: `REDIS_ADDR=` and
 * `DOCREADER_ADDR=` tell WeKnora "there is no such service", which is what keeps lite from dialling
 * a queue or a Python parser that we do not ship.
 */
export function sidecarEnv(input: SidecarEnvInput): NodeJS.ProcessEnv {
  const parent = input.parent ?? process.env;
  const paths = sidecarPaths(input.dataDir);
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = parent[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return {
    ...env,
    // Listen address: loopback only, on the port we already proved is free.
    //
    // There is no explicit `os.Getenv("SERVER_PORT")` in WeKnora. The binding is viper's:
    // `config/config.yaml` declares `server.port` / `server.host`, and `LoadConfig` turns on
    // `AutomaticEnv()` with a `.` -> `_` key replacer, so those two keys are overridable as
    // `SERVER_PORT` / `SERVER_HOST` (upstream documents exactly this in
    // `website-docs/01-getting-started/04-configuration.md`). Writing our own `config.yaml`
    // instead would mean copying the whole `config/` tree — prompt templates, builtin models and
    // agents all resolve relative to the file viper loaded — for no extra guarantee. If the
    // override ever stops working the readiness probe on *our* port fails and the backend reports
    // itself unavailable, which is a visible degrade rather than a silent wrong-port success.
    SERVER_PORT: String(input.port),
    SERVER_HOST: "127.0.0.1",
    GIN_MODE: "release",
    LOG_LEVEL: "warn",
    // Storage: one SQLite file and one blob directory, both under our data dir.
    DB_DRIVER: "sqlite",
    DB_PATH: paths.db,
    RETRIEVE_DRIVER: "sqlite",
    STORAGE_TYPE: "local",
    LOCAL_STORAGE_BASE_DIR: paths.files,
    // Everything lite does not ship: no queue, no graph database, no sandbox, no Python parser.
    STREAM_MANAGER_TYPE: "memory",
    REDIS_ADDR: "",
    NEO4J_ENABLE: "false",
    // Dead upstream at the pinned commit (`ENABLE_GRAPH_RAG` and `WEKNORA_SANDBOX_MODE` appear only
    // in `.env.lite.example`; `NEO4J_ENABLE` is what actually gates graph RAG). Set anyway: they are
    // free, they document the intent, and a later release may start reading them again.
    ENABLE_GRAPH_RAG: "false",
    WEKNORA_SANDBOX_MODE: "disabled",
    DOCREADER_ADDR: "",
    // Offline: DuckDB otherwise runs `INSTALL spatial` against extensions.duckdb.org at startup.
    DUCKDB_SKIP_EXTENSION_LOAD: "1",
    // Single local tenant, bootstrapped once through /auth/auto-setup. Nothing else may register.
    DISABLE_REGISTRATION: "true",
    // `SYSTEM_AES_KEY` is the live name (`internal/utils/crypto.go`); `TENANT_AES_KEY` is the
    // deprecated one still printed in `.env.lite.example`. Both carry the same 32-char key so the
    // sidecar can decrypt its stored model keys whichever name its build reads.
    SYSTEM_AES_KEY: input.aesKey,
    TENANT_AES_KEY: input.aesKey,
    // Without this every restart mints a new signing secret and invalidates the bootstrap JWT
    // mid-flight (`internal/application/service/user.go`).
    JWT_SECRET: input.jwtSecret,
  };
}

/** Keys that must never reach the sidecar. Asserted by a test, not merely documented. */
export const FORBIDDEN_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_API_KEY",
  "AGENTFORGE_SECRETS_KEY",
  "DATABASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "OLLAMA_BASE_URL",
] as const;
