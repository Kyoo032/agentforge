import { existsSync, lstatSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  VIDEO_EXAMPLES,
  videoExampleByFile,
  videoExampleTemplate,
  type PromptTemplate,
  type VideoExample,
} from "@agentforge/core/edit";

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

const DEV_RELATIVE = path.join("apps", "desktop", "resources", "examples", "videos");
/** Example clips are re-encoded small by scripts/video-examples.mjs; anything larger is not one we shipped. */
export const VIDEO_EXAMPLE_MAX_BYTES = 40 * 1024 * 1024;
export const VIDEO_EXAMPLE_MIME = "video/mp4";

export type VideoExampleItem = {
  file: string;
  url: string;
  templateId: string;
  title: string;
  prompt: string;
  aspect: PromptTemplate["aspect"];
  seconds: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  model?: string;
};

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
 * Where the bundled example clips live. Offline only: the packaged Electron resources folder,
 * then the env override, then the repo checkout for webdev. Same rules as the Edit starters.
 */
export function videoExamplesDir(): string | null {
  const resourcesPath = (process as ProcessWithResources).resourcesPath;
  if (process.versions.electron && resourcesPath) {
    const packaged = path.join(resourcesPath, "examples", "videos");
    return existsSync(packaged) ? packaged : null;
  }
  const fromEnv = process.env.AGENTFORGE_VIDEO_EXAMPLES_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return findUp(process.cwd(), DEV_RELATIVE);
}

/** Why a manifest file cannot be served from `dir`, or null when it is a plain file inside it. */
export function videoExampleFileProblem(dir: string, name: string): string | null {
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
  if (stat.size > VIDEO_EXAMPLE_MAX_BYTES) {
    return "too large";
  }
  try {
    const realDir = realpathSync(dir);
    const realFile = realpathSync(source);
    return realFile.startsWith(realDir + path.sep) ? null : "outside examples dir";
  } catch {
    return "unreadable";
  }
}

export function videoExampleUrl(file: string): string {
  return `/api/v1/videos/examples/${file}/file`;
}

function toItem(example: VideoExample): VideoExampleItem {
  const template = videoExampleTemplate(example);
  return {
    file: example.file,
    url: videoExampleUrl(example.file),
    templateId: template.id,
    title: template.title,
    prompt: template.prompt,
    aspect: template.aspect,
    seconds: template.seconds,
    ...(example.width ? { width: example.width } : {}),
    ...(example.height ? { height: example.height } : {}),
    ...(example.durationSeconds ? { durationSeconds: example.durationSeconds } : {}),
    ...(example.model ? { model: example.model } : {}),
  };
}

/** Manifest entries whose clip is actually on disk, in manifest order. Never throws. */
export function listVideoExamples(): VideoExampleItem[] {
  const dir = videoExamplesDir();
  if (!dir) {
    return [];
  }
  const items: VideoExampleItem[] = [];
  for (const example of VIDEO_EXAMPLES.examples) {
    if (videoExampleFileProblem(dir, example.file) === null) {
      items.push(toItem(example));
    }
  }
  return items;
}

/** Bytes of one bundled clip, or null when the name is not in the manifest or the file is unusable. */
export async function readVideoExample(name: string): Promise<Uint8Array | null> {
  if (!videoExampleByFile(name)) {
    return null;
  }
  const dir = videoExamplesDir();
  if (!dir || videoExampleFileProblem(dir, name) !== null) {
    return null;
  }
  const bytes = await readFile(path.join(dir, name));
  return new Uint8Array(bytes);
}
