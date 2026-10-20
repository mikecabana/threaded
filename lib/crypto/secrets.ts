import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "@/lib/env";

// AES-256-GCM for secrets at rest (Threads tokens, BYOK keys).
//
// SECRETS_ENC_KEY is a keyring: comma-separated "id:base64key" entries, the
// first being the one used to encrypt. A bare base64 key is treated as id "k1".
// Rotate by prepending a new entry and re-encrypting in the background; old
// entries keep decrypting until removed.
//
// Ciphertext format: "<keyId>.<iv>.<ciphertext>.<tag>" (base64url parts).
// `context` is bound as additional authenticated data, so a ciphertext copied
// to another row (e.g. another profile's token) fails to decrypt.

export interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

export function parseKeyring(value: string): Keyring {
  const keys = new Map<string, Buffer>();
  let currentId = "";
  for (const [index, entry] of value
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .entries()) {
    const [id, encoded] = entry.includes(":") ? entry.split(":", 2) : ["k1", entry];
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (got ${key.length}).`);
    if (keys.has(id)) throw new Error(`Duplicate encryption key id "${id}".`);
    keys.set(id, key);
    if (index === 0) currentId = id;
  }
  if (!currentId) throw new Error("No encryption keys configured.");
  return { currentId, keys };
}

let cached: Keyring | undefined;
function keyring(): Keyring {
  cached ??= parseKeyring(requireEnv("SECRETS_ENC_KEY"));
  return cached;
}

export function encryptSecret(plaintext: string, context: string, ring: Keyring = keyring()): string {
  const key = ring.keys.get(ring.currentId);
  if (!key) throw new Error("Current encryption key missing.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ring.currentId, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(sealed: string, context: string, ring: Keyring = keyring()): string {
  const [id, iv, ciphertext, tag] = sealed.split(".");
  const key = id ? ring.keys.get(id) : undefined;
  if (!key || !iv || !ciphertext || !tag) throw new Error("Unreadable secret.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** True when the secret was sealed with an older key and should be re-encrypted. */
export function needsRotation(sealed: string, ring: Keyring = keyring()): boolean {
  return sealed.split(".", 1)[0] !== ring.currentId;
}
