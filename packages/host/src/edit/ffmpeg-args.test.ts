import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { assertKnownRecipe } from "./ffmpeg/recipes";
import { minimalEnv, runFfmpeg, setExecFileForTests } from "./ffmpeg/run";

describe("ffmpeg args (G-13)", () => {
  afterEach(() => {
    setExecFileForTests(null);
  });

  it("uses execFile with a stripped env and never a shell", async () => {
    process.env.OPENAI_API_KEY = "sk-secret";
    process.env.AGENTFORGE_SECRETS_KEY = "wrap";
    const execFile = vi.fn(async (_file: string, argv: readonly string[] | string[] | undefined, options: { env?: NodeJS.ProcessEnv }) => {
      expect(options.env?.OPENAI_API_KEY).toBeUndefined();
      expect(options.env?.AGENTFORGE_SECRETS_KEY).toBeUndefined();
      expect(argv?.some((part) => String(part).includes("rm -rf"))).toBe(false);
      return { stdout: "out_time_us=1000\nprogress=end\n", stderr: "" };
    });
    setExecFileForTests(execFile as never);
    // Unconditional now. This used to bail out with a bare "it rejects" whenever ffmpeg was not
    // installed, which meant the env-stripping assertions inside the stub above — the whole point
    // of G-13 — never ran on a machine without it, and so never ran in CI. `setExecFileForTests`
    // reaches the stub whether or not a real binary exists (see ./ffmpeg/run.ts), so the checks
    // now run everywhere. `run-missing-binary.test.ts` covers the refusal this replaces.
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
    expect(execFile).toHaveBeenCalled();
    const env = minimalEnv({ OPENAI_API_KEY: "sk", AGENTFORGE_SECRETS_KEY: "x", PATH: "/usr/bin" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AGENTFORGE_SECRETS_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("rejects an unknown recipe", () => {
    expect(() => assertKnownRecipe("rm -rf /")).toThrow(ApiError);
  });
});
