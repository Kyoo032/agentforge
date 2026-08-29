import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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

type Keytar = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
};

function loadKeytar(): Keytar | null {
  try {
    const require = createRequire(import.meta.url);
    return require("keytar") as Keytar;
  } catch {
    return null;
  }
}

function readOrCreateMasterKeyFile(): string {
  const file = resolve(localDataDir(), ".master-key");
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

/** Copy wrap key into the OS keychain when the native module is available (Windows Credential Manager via keytar). */
export async function hydrateWrapKeyFromKeychain(): Promise<"env" | "keychain" | "file"> {
  if (process.env.AGENTFORGE_SECRETS_KEY?.trim()) {
    return "env";
  }
  const keytar = loadKeytar();
  if (keytar) {
    try {
      const stored = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (stored?.trim()) {
        process.env.AGENTFORGE_SECRETS_KEY = stored.trim();
        return "keychain";
      }
      const secret = readOrCreateMasterKeyFile();
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret);
      process.env.AGENTFORGE_SECRETS_KEY = secret;
      return "keychain";
    } catch {
      // libsecret / Credential Manager missing — file fallback.
    }
  }
  return "file";
}

export function getLocalVaultKey(): Buffer {
  const fromEnv = process.env.AGENTFORGE_SECRETS_KEY?.trim();
  if (fromEnv) {
    return wrappingKeyFromSecret(fromEnv);
  }
  return wrappingKeyFromSecret(readOrCreateMasterKeyFile());
}
