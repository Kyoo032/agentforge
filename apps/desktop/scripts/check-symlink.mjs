#!/usr/bin/env node
/**
 * Preflight: Next standalone tracing recreates pnpm symlinks.
 * Fail fast on Windows when Developer Mode (or elevation) is missing.
 */
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(tmpdir(), `agentforge-symlink-check-${process.pid}`);
const target = join(dir, "target.txt");
const link = join(dir, "link.txt");

try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, "ok\n");
  symlinkSync(target, link);
  console.log("OK: symlink create works (Developer Mode or elevated shell).");
  process.exitCode = 0;
} catch (err) {
  const code = err && typeof err === "object" ? err.code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  const needsPriv =
    code === "EPERM" ||
    code === "EACCES" ||
    /Administrator privilege required/i.test(message);

  if (needsPriv) {
    console.error(
      "Symlink create failed (EPERM/EACCES). Next standalone tracing recreates pnpm symlinks.\n" +
        "Enable Windows Developer Mode (Settings > System > For developers > Developer Mode)\n" +
        "OR run the build from an elevated shell.",
    );
  } else {
    console.error(`Symlink preflight failed: ${message}`);
  }
  process.exitCode = 1;
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
