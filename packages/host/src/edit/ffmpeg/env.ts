/**
 * The environment every spawned media binary is allowed to see.
 *
 * Its own module so that both the runner (`./run`) and the binary probe (`../ffmpeg-binary`) can
 * use it without importing each other — the runner already imports the probe to resolve a path.
 */

/**
 * An allowlist, not a denylist: a secret added to `process.env` tomorrow is excluded because it was
 * never named, rather than because someone remembered to name it. Every `execFile` that runs
 * ffmpeg, ffprobe, or a probe of either goes through this, so the wrap key is never one
 * `child.env` away from a binary we did not build.
 */
export function minimalEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "TMP", "TEMP", "TMPDIR", "SystemRoot", "SYSTEMROOT", "ComSpec", "PATHEXT"]) {
    if (source[key]) {
      env[key] = source[key];
    }
  }
  return env;
}
