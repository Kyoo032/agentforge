import { ensureFileWrapSecret } from "./vault-key";

const KEYCHAIN_SERVICE = "Agentforge";
const KEYCHAIN_ACCOUNT = "wrap-key";

type Keytar = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
};

/**
 * Copy wrap key into the OS keychain when keytar is available.
 * Import this only from Node instrumentation — never from client bundles.
 */
export async function hydrateWrapKeyFromKeychain(): Promise<"env" | "keychain" | "file"> {
  if (process.env.AGENTFORGE_SECRETS_KEY?.trim()) {
    return "env";
  }
  try {
    const loaded = await import("keytar");
    const keytar = ((loaded as { default?: Keytar }).default ?? loaded) as Keytar;
    if (typeof keytar.getPassword !== "function") {
      return "file";
    }
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (stored?.trim()) {
      process.env.AGENTFORGE_SECRETS_KEY = stored.trim();
      return "keychain";
    }
    const secret = ensureFileWrapSecret();
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret);
    process.env.AGENTFORGE_SECRETS_KEY = secret;
    return "keychain";
  } catch {
    return "file";
  }
}
