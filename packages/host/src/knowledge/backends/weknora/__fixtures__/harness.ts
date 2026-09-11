import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSettings } from "../../../../settings-store";
import type { SidecarHandle } from "../supervisor";
import { resetBackendHealthForTests, setWeknoraBackendForTests } from "../../../registry";
import { WeKnoraBackend } from "../backend";
import { forgetVerifiedBinding } from "../bootstrap";
import { startFakeWeKnora, type FakeWeKnora } from "./fake-weknora";
import { stubSidecar } from "./stub-sidecar";

/**
 * A desk wired to a fake WeKnora sidecar: isolated settings, a supervisor that spawns nothing, and
 * the registry pointed at the result. Everything the backend does above the wire — bootstrap,
 * ingest, retrieval, outbox, degraded fallback — is exercisable from here on a machine that has no
 * WeKnora build.
 */

export type WeKnoraHarness = {
  fake: FakeWeKnora;
  backend: WeKnoraBackend;
  settingsDir: string;
  teardown(): Promise<void>;
};

const ENV_KEYS = ["AGENTFORGE_SETTINGS_PATH", "AGENTFORGE_RUNTIME", "AGENTFORGE_WEKNORA_PATH"] as const;

export async function startWeKnoraHarness(
  options: { select?: boolean; sidecar?: (baseUrl: string) => SidecarHandle } = {},
): Promise<WeKnoraHarness> {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const settingsDir = mkdtempSync(join(tmpdir(), "af-weknora-"));
  process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  process.env.AGENTFORGE_RUNTIME = "stub";
  // Binary resolution is a real `stat`, so the availability check needs a real file. Node's own
  // executable is the one every machine running these tests is guaranteed to have.
  process.env.AGENTFORGE_WEKNORA_PATH = process.execPath;

  // Per-process caches keyed by workspace id, from a desk that no longer exists.
  forgetVerifiedBinding();
  const fake = await startFakeWeKnora();
  const backend = new WeKnoraBackend(options.sidecar?.(fake.baseUrl) ?? stubSidecar(fake.baseUrl));
  setWeknoraBackendForTests(backend);
  if (options.select !== false) {
    saveSettings({ knowledgeBackend: "weknora" });
  }
  return {
    fake,
    backend,
    settingsDir,
    teardown: async () => {
      setWeknoraBackendForTests(null);
      resetBackendHealthForTests();
      forgetVerifiedBinding();
      await fake.close();
      for (const key of ENV_KEYS) {
        const value = previous[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(settingsDir, { recursive: true, force: true });
    },
  };
}
