import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export type EncryptedEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  /** base64-encoded 12-byte IV/nonce */
  n: string;
  /** base64-encoded ciphertext */
  ct: string;
  /** base64-encoded 16-byte GCM auth tag */
  tag: string;
};

export function wrappingKeyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptJson(value: unknown, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    n: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptJson<T>(envelope: EncryptedEnvelope, key: Buffer): T {
  const iv = Buffer.from(envelope.n, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    e["v"] === 1 &&
    e["alg"] === "aes-256-gcm" &&
    typeof e["n"] === "string" &&
    typeof e["ct"] === "string" &&
    typeof e["tag"] === "string"
  );
}

export function sealPayload(value: unknown, key: Buffer): EncryptedEnvelope {
  return encryptJson(value, key);
}

export function openPayload<T>(stored: unknown, key: Buffer): T {
  if (isEnvelope(stored)) {
    return decryptJson<T>(stored, key);
  }
  return stored as T;
}
