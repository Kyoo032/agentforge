/**
 * `<localDataDir()>/logs/components.log` — one line per stage transition, so a failed first run can
 * be diagnosed after the fact without asking the owner to reproduce it.
 *
 * PRIVACY — a line only ever contains a component id, a stage id, a state, a duration, a package
 * name and an error message the code above produced. Never a URL (the manifest's are public and
 * carry no credentials, but a log is not the place for them), never a file the owner opened, never a
 * prompt, never a key. Logging is best-effort: a read-only or full disk must not fail an install.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { redactSecrets } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";

export const COMPONENTS_LOG_DIR = "logs";
export const COMPONENTS_LOG_FILE = "components.log";

export function componentsLogPath(): string {
  return resolve(localDataDir(), COMPONENTS_LOG_DIR, COMPONENTS_LOG_FILE);
}

/** Collapse a line to one row of text: a newline in a message must not forge a second entry. */
function oneLine(message: string): string {
  return redactSecrets(message)
    .replace(/[\r\n\t]+/g, " ")
    .trim();
}

export function appendComponentLog(message: string): void {
  try {
    const path = componentsLogPath();
    mkdirSync(resolve(localDataDir(), COMPONENTS_LOG_DIR), { recursive: true });
    appendFileSync(path, `${new Date().toISOString()} ${oneLine(message)}\n`, "utf8");
  } catch {
    // A log that cannot be written costs a diagnostic, never the install.
  }
}
