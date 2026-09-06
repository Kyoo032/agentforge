import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { assertKnownRecipe } from "./ffmpeg/recipes";
import { minimalEnv, runFfmpeg, setExecFileForTests } from "./ffmpeg/run";
import { resolveFfmpeg } from "./ffmpeg-binary";

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
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg.found) {
      await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).rejects.toBeInstanceOf(ApiError);
      return;
    }
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
