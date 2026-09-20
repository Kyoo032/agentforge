import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { providerEnv } from "./server-mode";

/**
 * Phase 4 — the operator's keys are not a tenant's keys, swept rather than trusted.
 *
 * Three call sites (`edit/asr.ts`, `runtime/ai-sdk-runtime.ts`, `tools/credentials.ts`) still fell
 * back to `process.env.OPENAI_API_KEY` and friends after the first pass at this closed the one in
 * `resolveProviderKeys`. The Edit one was the live hole: that job runs on the timeline worker, off
 * the request, with no gate re-check behind it, so a hosted tenant could enqueue a transcription
 * while keyed, sign out, and have it charged to the OPERATOR's key.
 *
 * Reviewing the three is not the fix; the fix is that a FOURTH cannot appear unnoticed. Same idea as
 * the desk-id and filename guards in `packages/host/src/tenant-state.test.ts`: assert the shape of
 * the call, in a rule the compiler cannot express.
 *
 * The rule: outside its one owner, no shipped source reads a provider credential straight off
 * `process.env`. Reading it off a local binding is fine and is what the fixed sites do, because that
 * binding came from `providerEnv()`, which is empty in server mode.
 */
describe("no source reads a provider credential straight off process.env", () => {
  /**
   * The names that decide who pays for a model call, and who a tool authenticates as. Model ids
   * (`IMAGE_GEN_MODEL`, `AGENTFORGE_MEETING_ASR_MODEL`) are deliberately absent: they are operator
   * configuration, not credentials, and a tenant reading one costs nobody anything.
   */
  const CREDENTIAL_ENV = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GENERATIVE_AI_BASE_URL",
    "ARK_API_KEY",
    "ARK_BASE_URL",
    "VOLCENGINE_API_KEY",
    "VOLCENGINE_BASE_URL",
    "TAVILY_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "FAL_KEY",
  ];

  /** Owns the rule, so it is the one file allowed to name `process.env` beside these. */
  const OWNER = "server-mode.ts";

  const PACKAGES = [path.join(__dirname), path.join(__dirname, "..", "..", "host", "src")];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...sourceFiles(full));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== OWNER) {
        out.push(full);
      }
    }
    return out;
  }

  /** The comment on the Edit fix quotes the very read it removed; only real code counts. */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const READ = new RegExp(`process\\.env(?:\\.(${CREDENTIAL_ENV.join("|")})\\b|\\[\\s*"(${CREDENTIAL_ENV.join("|")})"\\s*\\])`, "g");

  it("has no shipped source outside server-mode.ts reading one", () => {
    const offenders: string[] = [];
    for (const root of PACKAGES) {
      for (const file of sourceFiles(root)) {
        const text = withoutComments(readFileSync(file, "utf8"));
        for (const match of text.matchAll(READ)) {
          offenders.push(`${path.relative(path.join(__dirname, "..", "..", ".."), file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the sweep's own bait, so an empty result means it looked", () => {
    // Without this the case above passes just as happily on a broken regex or an empty file list.
    const bait = withoutComments(`const key = process.env.OPENAI_API_KEY ?? process.env["FAL_KEY"];`);
    expect([...bait.matchAll(READ)].map((match) => match[0])).toEqual([
      "process.env.OPENAI_API_KEY",
      `process.env["FAL_KEY"]`,
    ]);
    expect(sourceFiles(PACKAGES[0] as string).length).toBeGreaterThan(50);
    expect(sourceFiles(PACKAGES[1] as string).length).toBeGreaterThan(50);
  });
});

/**
 * The behaviour the sweep above protects: what a fallback hands back in each mode.
 *
 * `resolveProviderKeys` has its own coverage in `packages/host/src/tenant-secrets.test.ts`; these
 * two cases pin the helper every other site now shares, so a change there cannot quietly re-open the
 * desktop's documented `.env` fallback or the hosted refusal.
 */
describe("providerEnv", () => {
  it("returns the environment unchanged off server mode", () => {
    const env = { OPENAI_API_KEY: "sk-dev-box", AGENTFORGE_SERVER: "0" };
    expect(providerEnv(env).OPENAI_API_KEY).toBe("sk-dev-box");
  });

  it("returns an empty environment in server mode", () => {
    const env = { OPENAI_API_KEY: "sk-operator-key-do-not-share", AGENTFORGE_SERVER: "1" };
    expect(providerEnv(env).OPENAI_API_KEY).toBeUndefined();
    expect(Object.keys(providerEnv(env))).toEqual([]);
  });

  it("is frozen, so a caller cannot write a key back into it", () => {
    const hosted = providerEnv({ AGENTFORGE_SERVER: "1" });
    // A module is strict, so the write throws rather than failing silently.
    expect(() => {
      hosted.OPENAI_API_KEY = "sk-smuggled";
    }).toThrow();
    expect(hosted.OPENAI_API_KEY).toBeUndefined();
  });
});
