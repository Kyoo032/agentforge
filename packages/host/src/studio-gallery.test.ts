/**
 * A gallery row whose file is gone, on the routes the Videos, Images and Music pages list.
 *
 * On the dev desk `GET /api/v1/videos` listed 72 rows and `GET /api/v1/media/<id>/file` answered 404
 * for half of them, so the page mounted a player per row and opened dozens of failing loads. The
 * host cannot fix a missing file, and must not delete the owner's row, so it says so: `fileMissing`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "./__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "./types";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-studio-gallery-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "e".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

function request(method: string, path: string): HostRequest {
  return { method, path, query: {}, params: {}, headers: {} };
}

async function gallery(path: string): Promise<Array<{ id: string; url: string; fileMissing?: boolean }>> {
  const result = await dispatch(request("GET", path));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return (result.body as { items: Array<{ id: string; url: string; fileMissing?: boolean }> }).items;
}

async function fileStatus(url: string): Promise<number> {
  const result = await dispatch(request("GET", url));
  return result.status;
}

beforeAll(async () => {
  ({ dispatch } = await import("./router"));
}, ROUTER_IMPORT_BUDGET_MS);

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("gallery rows whose file is gone", () => {
  it("marks the stale row fileMissing, keeps it listed, and leaves a present row unmarked", async () => {
    const [{ getTenant }, { saveMedia, mediaRoot }] = await Promise.all([import("./tenant"), import("./media")]);
    const tenant = await getTenant(request("GET", "/api/v1/videos"));
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const kept = await saveMedia(tenant, new File([bytes], "kept.mp4", { type: "video/mp4" }), ["video"]);
    const stale = await saveMedia(tenant, new File([bytes], "stale.mp4", { type: "video/mp4" }), ["video"]);
    rmSync(join(mediaRoot(), stale.storagePath), { force: true });

    // The precondition of the bug: the row lists, and its file answers 404.
    expect(await fileStatus(stale.url)).toBe(404);
    expect(await fileStatus(kept.url)).toBe(200);

    const items = await gallery("/api/v1/videos");
    const keptItem = items.find((item) => item.id === kept.id);
    const staleItem = items.find((item) => item.id === stale.id);
    expect(keptItem).toBeDefined();
    expect(keptItem).not.toHaveProperty("fileMissing");
    expect(staleItem).toBeDefined();
    expect(staleItem?.fileMissing).toBe(true);
  });

  it("does not delete the row: it is still there on the next list", async () => {
    const before = (await gallery("/api/v1/videos")).filter((item) => item.fileMissing === true).length;
    expect(before).toBeGreaterThan(0);
    const after = (await gallery("/api/v1/videos")).filter((item) => item.fileMissing === true).length;
    expect(after).toBe(before);
  });

  it("marks a row whose stored path is not this desk's as missing, since a reader gets a 404 for it too", async () => {
    const [{ getTenant }, { db, media }] = await Promise.all([import("./tenant"), import("@agentforge/db")]);
    const tenant = await getTenant(request("GET", "/api/v1/images"));
    const id = crypto.randomUUID();
    await db.insert(media).values({
      id,
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      kind: "image",
      mime: "image/png",
      sizeBytes: 1,
      storagePath: "tenants/someone-else/org/elsewhere.png",
      url: `/api/v1/media/${id}/file`,
    });
    const item = (await gallery("/api/v1/images")).find((row) => row.id === id);
    expect(item?.fileMissing).toBe(true);
  });

  it("marks stale rows on the music gallery too", async () => {
    const [{ getTenant }, { db, media }] = await Promise.all([import("./tenant"), import("@agentforge/db")]);
    const tenant = await getTenant(request("GET", "/api/v1/music"));
    const id = crypto.randomUUID();
    await db.insert(media).values({
      id,
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      kind: "audio",
      mime: "audio/mpeg",
      sizeBytes: 1,
      storagePath: `${tenant.organizationId}/${id}.mp3`,
      url: `/api/v1/media/${id}/file`,
    });
    const item = (await gallery("/api/v1/music")).find((row) => row.id === id);
    expect(item?.fileMissing).toBe(true);
  });
});
