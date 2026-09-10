#!/usr/bin/env node
/**
 * Generate the bundled Videos example clips into apps/desktop/resources/examples/videos/.
 *
 * The manifest (packages/core/src/edit/video-examples.json) lists one clip per prompt template.
 * Each clip is generated once through a running DPSBuddy host (the dev desk on :3000 or any
 * host URL) with that template's prompt, then re-encoded small (H.264, <= 1280 px, faststart)
 * so it plays instantly from disk. The app never fetches these at runtime: they ship inside the
 * installer next to the Edit starters. After a clip is written the manifest entry gets the
 * measured width, height, duration, model and date.
 *
 * Usage (repo root):
 *   node scripts/video-examples.mjs [--host http://127.0.0.1:3000] [--only file.mp4]... [--force] [--model id]
 *                                   [--seconds-allowed 4,6,8]   snap each template's seconds to the nearest value
 *                                                               the chosen model accepts (veo-3.1: 4 / 6 / 8)
 *   node scripts/video-examples.mjs --check     only verify every manifest file exists; exit 1 if not
 *
 * Needs ffmpeg + ffprobe on PATH (or AGENTFORGE_FFMPEG_PATH / AGENTFORGE_FFPROBE_PATH).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "packages/core/src/edit/video-examples.json");
const templatesPath = path.join(repoRoot, "packages/core/src/edit/prompt-templates.json");
const outDir = path.join(repoRoot, "apps/desktop/resources/examples/videos");

const DEFAULT_HOST = "http://127.0.0.1:3000";
const MAX_EDGE_PX = 1280;
const CRF = "27";

function parseArgs(argv) {
  const args = { check: false, force: false, host: DEFAULT_HOST, only: [], model: undefined, secondsAllowed: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--host") args.host = argv[++i] ?? DEFAULT_HOST;
    else if (arg === "--only") args.only.push(argv[++i]);
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--seconds-allowed") {
      args.secondsAllowed = String(argv[++i] ?? "")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v > 0);
    }
    else throw new Error(`video-examples: unknown argument ${arg}`);
  }
  return args;
}

function binFromEnv(name, envVar) {
  const fromEnv = process.env[envVar]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : name;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const templates = JSON.parse(readFileSync(templatesPath, "utf8")).templates;
const args = parseArgs(process.argv.slice(2));

if (args.check) {
  const missing = manifest.examples.map((e) => e.file).filter((file) => !existsSync(path.join(outDir, file)));
  if (missing.length > 0) {
    console.error(`video-examples: missing ${missing.length} file(s) in ${outDir}: ${missing.join(", ")}`);
    console.error("Run `node scripts/video-examples.mjs` against a host with a gateway key, or drop your own files there.");
    process.exit(1);
  }
  console.log(`video-examples: all ${manifest.examples.length} files present in ${outDir}`);
  process.exit(0);
}

/** Plain node http request with no socket timeout: a video job can take several minutes. */
function request(url, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      target,
      { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, timeout: 0 },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * The template's duration, or the nearest value the target model accepts when --seconds-allowed
 * is set. Ties go to the longer clip (5 s -> 6 s, not 4 s) so the example is not shorter than the card says.
 */
function snapSeconds(seconds) {
  if (args.secondsAllowed.length === 0) return seconds;
  return args.secondsAllowed.reduce((best, v) => {
    const dv = Math.abs(v - seconds);
    const db = Math.abs(best - seconds);
    return dv < db || (dv === db && v > best) ? v : best;
  });
}

async function generateOne(entry, template) {
  const seconds = snapSeconds(template.seconds);
  const payload = {
    prompt: template.prompt,
    aspect: template.aspect,
    seconds,
    ...(args.model ? { model: args.model } : {}),
  };
  console.log(`video-examples: generating ${entry.file} from template ${template.id} (${seconds}s ${template.aspect})`);
  const created = await request(`${args.host}/api/v1/videos`, { method: "POST", body: payload });
  const text = created.body.toString("utf8");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`video-examples: host returned non-JSON (${created.status}): ${text.slice(0, 300)}`);
  }
  if (created.status >= 300 || !json.url) {
    throw new Error(`video-examples: generation failed (${created.status}): ${json.error?.message ?? text.slice(0, 300)}`);
  }
  const fileUrl = json.url.startsWith("http") ? json.url : `${args.host}${json.url}`;
  const download = await request(fileUrl);
  if (download.status !== 200 || download.body.length === 0) {
    throw new Error(`video-examples: could not download ${fileUrl} (${download.status})`);
  }
  return { bytes: download.body, model: json.model ?? args.model ?? null };
}

function encode(sourcePath, destPath) {
  const ffmpeg = binFromEnv("ffmpeg", "AGENTFORGE_FFMPEG_PATH");
  const tmpDest = `${destPath}.tmp.mp4`;
  execFileSync(
    ffmpeg,
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", sourcePath,
      "-vf", `scale='min(${MAX_EDGE_PX},iw)':-2`,
      "-c:v", "libx264", "-preset", "medium", "-crf", CRF, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      "-map_metadata", "-1",
      tmpDest,
    ],
    { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
  );
  renameSync(tmpDest, destPath);
}

function probe(filePath) {
  const ffprobe = binFromEnv("ffprobe", "AGENTFORGE_FFPROBE_PATH");
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { encoding: "utf8", windowsHide: true },
  );
  const info = JSON.parse(out);
  const video = (info.streams ?? []).find((s) => s.codec_type === "video");
  const duration = Number(info.format?.duration ?? 0);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds: Number.isFinite(duration) ? Math.round(duration * 10) / 10 : null,
  };
}

function writeManifest(next) {
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const scratch = path.join(tmpdir(), `agentforge-video-examples-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  let current = manifest;
  const wanted = current.examples.filter((entry) => args.only.length === 0 || args.only.includes(entry.file));
  const failures = [];
  for (const entry of wanted) {
    const dest = path.join(outDir, entry.file);
    if (existsSync(dest) && !args.force) {
      console.log(`video-examples: ${entry.file} already present, skipping (use --force to regenerate)`);
      continue;
    }
    const template = templates.find((t) => t.id === entry.templateId);
    if (!template) {
      failures.push(`${entry.file}: template ${entry.templateId} not found`);
      continue;
    }
    try {
      const generated = await generateOne(entry, template);
      const raw = path.join(scratch, entry.file);
      writeFileSync(raw, generated.bytes);
      encode(raw, dest);
      const measured = probe(dest);
      const updated = {
        ...entry,
        ...(measured.width ? { width: measured.width } : {}),
        ...(measured.height ? { height: measured.height } : {}),
        ...(measured.durationSeconds ? { durationSeconds: measured.durationSeconds } : {}),
        ...(generated.model ? { model: generated.model } : {}),
        generatedAt: new Date().toISOString().slice(0, 10),
      };
      current = { ...current, examples: current.examples.map((e) => (e.file === entry.file ? updated : e)) };
      writeManifest(current);
      console.log(
        `video-examples: wrote ${entry.file} (${measured.width}x${measured.height}, ${measured.durationSeconds}s, ${generated.model ?? "model unknown"})`,
      );
    } catch (error) {
      failures.push(`${entry.file}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`video-examples: ${entry.file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  if (failures.length > 0) {
    console.error(`video-examples: ${failures.length} clip(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`video-examples: done, ${wanted.length} clip(s) in ${outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
