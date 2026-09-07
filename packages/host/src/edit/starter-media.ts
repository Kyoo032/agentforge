import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOp, secondsToFrames, type EditProject, type TenantContext } from "@agentforge/core";
import { starterMediaFile, starterTrackFor, type StarterMediaFile, type StarterProject } from "@agentforge/core/edit";
import { db, media } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { mediaRoot } from "../media-root";
import { resolveFfmpeg } from "./ffmpeg-binary";
import { probe } from "./ffmpeg/recipes";

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

const DEV_RELATIVE = path.join("apps", "desktop", "resources", "starters");
/** Bundled clips are small; anything larger is not a starter file we shipped. */
export const STARTER_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

function findUp(start: string, relative: string): string | null {
  let current = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Where the bundled starter media lives. Offline only: env override, then the packaged
 * Electron resources folder, then the repo checkout for webdev.
 */
export function starterMediaDir(): string | null {
  const resourcesPath = (process as ProcessWithResources).resourcesPath;
  if (process.versions.electron && resourcesPath) {
    // Packaged app: only the bundled folder. The env override is a dev/test hook and is ignored here.
    const packaged = path.join(resourcesPath, "starters");
    return existsSync(packaged) ? packaged : null;
  }
  const fromEnv = process.env.AGENTFORGE_STARTER_MEDIA_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return findUp(process.cwd(), DEV_RELATIVE);
}

/**
 * A starter file must be a regular file (no symlink hop) that really lives inside the
 * starter dir and is not absurdly large. Returns the reason it was rejected, or null.
 */
export function starterFileProblem(dir: string, name: string): string | null {
  const source = path.join(dir, name);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(source);
  } catch {
    return "missing";
  }
  if (stat.isSymbolicLink()) {
    return "symlink";
  }
  if (!stat.isFile()) {
    return "not a file";
  }
  if (stat.size > STARTER_MEDIA_MAX_BYTES) {
    return "too large";
  }
  try {
    const realDir = realpathSync(dir);
    const realFile = realpathSync(source);
    const inside = realFile.startsWith(realDir + path.sep);
    return inside ? null : "outside starter dir";
  } catch {
    return "unreadable";
  }
}

type Probed = {
  durationSeconds: number;
  fps: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  codec?: string;
  sampleRate?: number;
};

function fromManifest(file: StarterMediaFile): Probed {
  return {
    durationSeconds: file.durationSeconds,
    fps: file.fps ?? 30,
    width: file.width,
    height: file.height,
    hasAudio: file.hasAudio,
  };
}

async function probeOrManifest(absPath: string, projectId: string, file: StarterMediaFile): Promise<Probed> {
  if (!resolveFfmpeg().found) {
    return fromManifest(file);
  }
  try {
    const probed = await probe(absPath, projectId);
    if (probed.durationSeconds <= 0) {
      console.warn(`[edit] ffprobe returned no duration for starter file ${path.basename(absPath)}; using manifest metadata`);
      return fromManifest(file);
    }
    return probed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[edit] ffprobe failed for starter file ${path.basename(absPath)} (${message}); using manifest metadata`);
    return fromManifest(file);
  }
}

async function copyIntoMediaRoot(tenant: TenantContext, source: string, file: StarterMediaFile) {
  const bytes = await readFile(source);
  const id = crypto.randomUUID();
  const ext = file.mime === "audio/mp4" ? "m4a" : "mp4";
  const relative = `${tenant.organizationId}/${id}.${ext}`;
  const fullPath = path.join(mediaRoot(), relative);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
  await db.insert(media).values({
    id,
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    kind: file.kind,
    mime: file.mime,
    sizeBytes: bytes.byteLength,
    storagePath: relative,
    url: `/api/v1/media/${id}/file`,
  });
  return { id, relative, fullPath };
}

type StoredFile = { id: string; fullPath: string };

/** Undo copies from a partial seed so no orphan media rows or files are left behind. */
async function rollbackStored(stored: StoredFile[]): Promise<void> {
  for (const item of stored) {
    try {
      await db.delete(media).where(eq(media.id, item.id));
    } catch (error) {
      console.warn(`[edit] rollback: could not delete media row ${item.id}: ${String(error)}`);
    }
    try {
      await unlink(item.fullPath);
    } catch (error) {
      console.warn(`[edit] rollback: could not delete ${item.fullPath}: ${String(error)}`);
    }
  }
}

export type SeededStarterMedia = {
  doc: EditProject;
  placed: string[];
  missing: string[];
};

/**
 * Lay the starter's bundled clips on the timeline. Video goes on v1 after any seeded
 * title, audio on a1 from frame 0. Missing files are skipped and reported, never fetched.
 */
export async function seedStarterMedia(
  tenant: TenantContext,
  doc: EditProject,
  starter: StarterProject | undefined,
): Promise<SeededStarterMedia> {
  const refs = starter?.media ?? [];
  if (refs.length === 0) {
    return { doc, placed: [], missing: [] };
  }
  const dir = starterMediaDir();
  const placed: string[] = [];
  const missing: string[] = [];
  const storedFiles: StoredFile[] = [];
  let next = doc;
  const cursor: Record<"v1" | "a1", number> = {
    v1: Math.max(0, ...next.clips.filter((clip) => clip.trackId === "v1").map((clip) => clip.timelineStartFrame + clip.durationFrames)),
    a1: 0,
  };
  try {
    for (const name of refs) {
      next = await placeOne(name);
    }
  } catch (error) {
    await rollbackStored(storedFiles);
    throw error;
  }
  return { doc: next, placed, missing };

  async function placeOne(name: string): Promise<EditProject> {
    const file = starterMediaFile(name);
    const problem = dir ? starterFileProblem(dir, name) : "no starter dir";
    if (!file || !dir || problem) {
      missing.push(problem && problem !== "missing" ? `${name} (${problem})` : name);
      return next;
    }
    const stored = await copyIntoMediaRoot(tenant, path.join(dir, name), file);
    storedFiles.push({ id: stored.id, fullPath: stored.fullPath });
    const probed = await probeOrManifest(stored.fullPath, next.id, file);
    const durationFrames = Math.max(1, secondsToFrames(probed.durationSeconds, probed.fps));
    const track = starterTrackFor(file);
    const assetId = crypto.randomUUID();
    const withAsset = applyOp(next, {
      type: "add_asset",
      payload: {
        asset: {
          id: assetId,
          mediaId: stored.id,
          kind: file.kind,
          storagePath: stored.relative,
          durationFrames,
          width: probed.width,
          height: probed.height,
          fps: probed.fps,
          hasAudio: probed.hasAudio,
          probe: { codec: probed.codec, sampleRate: probed.sampleRate },
        },
      },
    });
    const withClip = applyOp(withAsset, {
      type: "add_clip",
      payload: {
        clip: {
          id: crypto.randomUUID(),
          trackId: track,
          timelineStartFrame: cursor[track],
          durationFrames,
          source: { assetId, inFrame: 0 },
          status: "ready",
        },
      },
    });
    cursor[track] += durationFrames;
    placed.push(name);
    return withClip;
  }
}
