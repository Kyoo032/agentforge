import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaRoot } from "./media-root";

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

function metaPath(): string {
  return path.join(mediaRoot(), "studio-meta.json");
}

async function readStore(): Promise<MetaStore> {
  try {
    const raw = await readFile(metaPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MetaStore;
  } catch {
    return {};
  }
}

async function writeStore(store: MetaStore): Promise<void> {
  const file = metaPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

export async function saveStudioMediaMeta(entry: StudioMediaMeta): Promise<void> {
  const store = await readStore();
  store[entry.mediaId] = entry;
  await writeStore(store);
}

export async function getStudioMediaMeta(mediaId: string): Promise<StudioMediaMeta | null> {
  const store = await readStore();
  return store[mediaId] ?? null;
}

export async function listStudioMediaMeta(kind: StudioMediaMeta["kind"]): Promise<StudioMediaMeta[]> {
  const store = await readStore();
  return Object.values(store)
    .filter((entry) => entry.kind === kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
