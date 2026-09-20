import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tenantMediaRoot } from "./media-root";

export type StudioMediaMeta = {
  mediaId: string;
  kind: "image" | "video" | "audio";
  prompt: string;
  /** Images and videos only; a track has no canvas, so Music writes an empty string. */
  aspect: string;
  model: string;
  createdAt: string;
  /** Music only. The take's own title, the style tags it was given, and whether it has vocals. */
  title?: string;
  style?: string;
  instrumental?: boolean;
  durationSeconds?: number;
};

type MetaStore = Record<string, StudioMediaMeta>;

/**
 * Phase 3 lane D: one sidecar per tenant, under that tenant's media root. `<mediaRoot>/studio-meta.json`
 * for `local-tenant`, so a desktop install keeps the file it has; `<mediaRoot>/tenants/<id>/studio-meta.json`
 * for everyone else. One shared file would have held every tenant's prompts, titles and styles, and two
 * tenants generating at once would read-modify-write over each other.
 */
function metaPath(tenantId: string): string {
  return path.join(tenantMediaRoot(tenantId), "studio-meta.json");
}

async function readStore(tenantId: string): Promise<MetaStore> {
  try {
    const raw = await readFile(metaPath(tenantId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MetaStore;
  } catch {
    return {};
  }
}

async function writeStore(tenantId: string, store: MetaStore): Promise<void> {
  const file = metaPath(tenantId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

export async function saveStudioMediaMeta(tenantId: string, entry: StudioMediaMeta): Promise<void> {
  const store = await readStore(tenantId);
  store[entry.mediaId] = entry;
  await writeStore(tenantId, store);
}

export async function getStudioMediaMeta(tenantId: string, mediaId: string): Promise<StudioMediaMeta | null> {
  const store = await readStore(tenantId);
  return store[mediaId] ?? null;
}

export async function listStudioMediaMeta(tenantId: string, kind: StudioMediaMeta["kind"]): Promise<StudioMediaMeta[]> {
  const store = await readStore(tenantId);
  return Object.values(store)
    .filter((entry) => entry.kind === kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
