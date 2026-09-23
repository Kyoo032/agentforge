/**
 * `GET /api/v1/edit/doctor` names no server path on the hosted server.
 *
 * The report carried `ffmpeg.path`, the absolute path of the binary the host resolved. On a desk that
 * is the owner's own machine and the path helps them fix an install; on the hosted server it is the
 * operator's filesystem layout, handed to every signed-in tenant. There the path is dropped; `found`,
 * `version`, `reason` and the setup hint stay, because the renderer's banner reads those and nothing
 * in `apps/web` reads the path.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-edit-doctor-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

/**
 * A binary that does not exist, under a directory name nothing else in the tree contains. The probe
 * fails, and the report still names the path it tried — which is exactly what must not travel.
 */
const OPERATOR_DIR = "operator-private-dir-5e2c";
const FAKE_FFMPEG = join(dataDir, OPERATOR_DIR, "ffmpeg");

import { handleGetEditDoctor } from "../handlers/edit";
import type { HostJsonResult, HostRequest } from "../types";
import { resetDoctorRecheckThrottle } from "./doctor";
import { resetFfmpegBinaryCache } from "./ffmpeg-binary";

const PREVIOUS_FFMPEG = process.env.AGENTFORGE_FFMPEG_PATH;

function doctorRequest(): HostRequest {
  return { method: "GET", path: "/api/v1/edit/doctor", query: {}, params: {}, headers: {} };
}

async function ffmpegOf(): Promise<{ body: string; ffmpeg: Record<string, unknown> }> {
  const result = (await handleGetEditDoctor(doctorRequest())) as HostJsonResult;
  expect(result.status).toBe(200);
  const payload = result.body as { ffmpeg: Record<string, unknown> };
  return { body: JSON.stringify(result.body), ffmpeg: payload.ffmpeg };
}

beforeEach(() => {
  process.env.AGENTFORGE_FFMPEG_PATH = FAKE_FFMPEG;
  resetFfmpegBinaryCache();
  resetDoctorRecheckThrottle();
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  if (PREVIOUS_FFMPEG === undefined) {
    delete process.env.AGENTFORGE_FFMPEG_PATH;
  } else {
    process.env.AGENTFORGE_FFMPEG_PATH = PREVIOUS_FFMPEG;
  }
  resetFfmpegBinaryCache();
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort, as in test/global-setup.ts: on Windows an open handle can refuse the delete.
  }
});

describe("the Edit doctor report", () => {
  it("drops the binary's path on the hosted server and keeps found and version", async () => {
    process.env.AGENTFORGE_SERVER = "1";
    const { body, ffmpeg } = await ffmpegOf();

    expect(ffmpeg).not.toHaveProperty("path");
    expect(ffmpeg).toHaveProperty("found", false);
    expect(ffmpeg).toHaveProperty("version");
    // The banner still gets what it renders: why, and how to fix it.
    expect(ffmpeg).toHaveProperty("reason", "exec_failed");
    expect(ffmpeg).toHaveProperty("setup");
    expect(body).not.toContain(OPERATOR_DIR);
  });

  it("keeps the path on a desk, where the machine is the owner's own", async () => {
    const { ffmpeg } = await ffmpegOf();

    expect(ffmpeg.path).toBe(FAKE_FFMPEG);
    expect(ffmpeg.found).toBe(false);
  });
});
