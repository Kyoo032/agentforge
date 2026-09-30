import { resolve } from "node:path";
import {
  ANTHROPIC_API_VERSION,
  assertAllowedEndpointUrl,
  redactSecrets,
  resolvedGatewayBaseUrl,
  type ResolvedChatWire,
  type StoredSecrets,
} from "@agentforge/core";

/** The run is refused, and the message says why. It never contains a key. */
export class EvalRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalRefusal";
  }
}

/**
 * Which desk a run reads, or a refusal. The tool never guesses a desk: no `AGENTFORGE_DATA_DIR` is no
 * run. Enough on its own for a run that only reads what is saved and calls nothing.
 */
export function requireDataDir(env: NodeJS.ProcessEnv = process.env): { dataDir: string } {
  const dataDir = env.AGENTFORGE_DATA_DIR?.trim();
  if (!dataDir) {
    throw new EvalRefusal(
      "AGENTFORGE_DATA_DIR is not set. Point it at the desk whose saved gateway key should be used, e.g. C:\\Users\\rizky\\agentforge\\.webdev-data-design.",
    );
  }
  return { dataDir: resolve(dataDir) };
}

/**
 * A desk for a run that calls the gateway: the same, and never against the stub runtime, where there is
 * nothing real to measure.
 */
export function requireEvalDesk(env: NodeJS.ProcessEnv = process.env): { dataDir: string } {
  if (env.AGENTFORGE_RUNTIME?.trim().toLowerCase() === "stub") {
    throw new EvalRefusal(
      "AGENTFORGE_RUNTIME=stub: there is no gateway behind a stub runtime. Unset it (the tool reads the desk's saved key itself).",
    );
  }
  return requireDataDir(env);
}

/**
 * The gateway key and the endpoint it may be sent to. The key is a private field: it does not
 * serialise, does not print through `util.inspect` or a template string, and is not an own property, so
 * a `console.log(credentials)` or a `JSON.stringify` of a record that holds one cannot leak it. It leaves
 * only as the auth header of a request, and `redact` scrubs it out of anything the gateway echoes back.
 */
export class GatewayCredentials {
  readonly #key: string;
  readonly baseUrl: string;

  constructor(key: string, baseUrl: string) {
    // The same rule the host applies before it sends a key anywhere: https, or plain http on loopback only.
    assertAllowedEndpointUrl(baseUrl);
    this.#key = key;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  get host(): string {
    return new URL(this.baseUrl).host;
  }

  /** The header each wire's own SDK sends the key in, so a probe is authorised the way a run is. */
  authHeaders(wire: ResolvedChatWire): Record<string, string> {
    if (wire === "anthropic_messages") {
      return { "x-api-key": this.#key, "anthropic-version": ANTHROPIC_API_VERSION };
    }
    if (wire === "google_generate_content") {
      return { "x-goog-api-key": this.#key };
    }
    return { Authorization: `Bearer ${this.#key}` };
  }

  /**
   * The one explicit way to hand the key to code that needs the bare string (the host's own model-list
   * call). It returns whatever `use` returns; the key goes nowhere else.
   */
  withKey<T>(use: (key: string) => T): T {
    return use(this.#key);
  }

  /** Text with the key, and anything else `redactSecrets` knows, taken out. */
  redact(text: string): string {
    return redactSecrets(text.split(this.#key).join("[key]"));
  }

  toJSON(): { host: string } {
    return { host: this.host };
  }

  toString(): string {
    return `GatewayCredentials(${this.host}, key redacted)`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/** The host's own settings loader, passed in so this file stays free of the host's database stack. */
export type SettingsLoader = (workspace?: string) => StoredSecrets;

/**
 * The saved gateway key of the desk `AGENTFORGE_DATA_DIR` names, read by the host's own settings
 * loading, or a refusal. Only the saved key counts: an `OPENAI_API_KEY` in the shell is not used, so
 * a probe never bills a key the desk did not choose. The endpoint is the pinned gateway.
 */
export function loadGatewayCredentials(options: {
  env?: NodeJS.ProcessEnv;
  workspace?: string | undefined;
  loadSettings: SettingsLoader;
}): GatewayCredentials {
  const env = options.env ?? process.env;
  const { dataDir } = requireEvalDesk(env);
  const settings = options.loadSettings(options.workspace);
  const key = settings.openaiApiKey?.trim();
  if (!key) {
    throw new EvalRefusal(
      `No gateway key is saved for ${options.workspace ? `desk ${options.workspace}` : "the selected desk"} in ${dataDir}. Save one in Settings on that desk first.`,
    );
  }
  return new GatewayCredentials(key, resolvedGatewayBaseUrl());
}
