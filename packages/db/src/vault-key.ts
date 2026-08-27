import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "crypto";
import { wrappingKeyFromSecret } from "@agentforge/core";

export function localDataDir(): string {
  const override = process.env.AGENTFORGE_SETTINGS_PATH?.trim();
  if (!override) {
    return resolve(process.cwd(), "../../data");
  }
  if (/\.(json|enc)$/i.test(override)) {
    return dirname(override);
  }
  return override;
}

export function getLocalVaultKey(): Buffer {
  const fromEnv = process.env.AGENTFORGE_SECRETS_KEY?.trim();
  if (fromEnv) {
    return wrappingKeyFromSecret(fromEnv);
  }
  const file = resolve(localDataDir(), ".master-key");
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  return wrappingKeyFromSecret(readFileSync(file, "utf8").trim());
}
