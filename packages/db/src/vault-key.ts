import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "crypto";
import { wrappingKeyFromSecret } from "@agentforge/core";

const KEYCHAIN_SERVICE = "Agentforge";
const KEYCHAIN_ACCOUNT = "wrap-key";
export function localDataDir(): string {
  const settingsPath = process.env.AGENTFORGE_SETTINGS_PATH?.trim();
  if (settingsPath) {
    if (/\.(json|enc)$/i.test(settingsPath)) {
      return dirname(settingsPath);
    }
    return settingsPath;
  }
  const dataDir = process.env.AGENTFORGE_DATA_DIR?.trim();
  if (dataDir) {
    return dataDir;
  }
  return resolve(process.cwd(), "../../data");
}

export function sqliteFilePath(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url?.startsWith("postgres://") || url?.startsWith("postgresql://")) {
    throw new Error(
      "Postgres is no longer the product database. Unset DATABASE_URL (SQLite at data/agentforge.sqlite) or set DATABASE_URL=file:/path/to.sqlite. docker-compose.yml is a legacy local fallback only.",
    );
  }
  if (url?.startsWith("file:")) {
    return url.slice("file:".length);
  }
  if (url) {
    return url;
  }
  return resolve(localDataDir(), "agentforge.sqlite");
}

function readOrCreateMasterKeyFile(): string {
  const file = resolve(localDataDir(), ".master-key");
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

export function ensureFileWrapSecret(): string {
  return readOrCreateMasterKeyFile();
}

export function getLocalVaultKey(): Buffer {
  const fromEnv = process.env.AGENTFORGE_SECRETS_KEY?.trim();
  if (fromEnv) {
    return wrappingKeyFromSecret(fromEnv);
  }
  return wrappingKeyFromSecret(readOrCreateMasterKeyFile());
}

