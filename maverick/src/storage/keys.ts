import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";

// File-based key storage with AES-256-GCM encryption at rest.
// Keys are encrypted using a passphrase (the Bluesky app password) via scrypt KDF.
// Stored in ~/.maverick/keys/<handle>.key (or overridden via __MAVERICK_KEYS_DIR for testing).

function getKeysDir(): string {
  if (process.env.__MAVERICK_KEYS_DIR) {
    return process.env.__MAVERICK_KEYS_DIR;
  }
  return join(homedir(), ".maverick", "keys");
}

function ensureKeysDir(): void {
  mkdirSync(getKeysDir(), { recursive: true });
}

function keyPath(handle: string): string {
  // Sanitize handle for filesystem
  const safe = handle.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(getKeysDir(), `${safe}.key`);
}

// Derive an AES-256 key from the passphrase using scrypt.
// Parameters: N=2^17 (131072), r=8, p=1 — per OWASP 2024 recommendations
// for moderate security. The default Node.js N=16384 is too weak for
// protecting long-lived private keys against offline brute-force.
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS) as Buffer;
}

function encrypt(data: string, passphrase: string): string {
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(12); // GCM uses 12-byte IV
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    encrypted: encrypted.toString("base64"),
    tag: authTag.toString("base64"),
  });
}

function decrypt(stored: string, passphrase: string): string | null {
  try {
    const { salt, iv, encrypted, tag } = JSON.parse(stored);
    const key = deriveKey(passphrase, Buffer.from(salt, "base64"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

export async function getStoredKey(
  handle: string,
  passphrase: string,
): Promise<string | null> {
  const path = keyPath(handle);
  try {
    const raw = readFileSync(path, "utf-8").trim();

    // Try as encrypted JSON first
    if (raw.startsWith("{")) {
      return decrypt(raw, passphrase);
    }

    // Legacy plaintext key -- migrate by re-encrypting
    if (raw.startsWith("0x")) {
      await storeKey(handle, raw, passphrase);
      return raw;
    }

    return null;
  } catch {
    return null;
  }
}

export async function storeKey(
  handle: string,
  privateKey: string,
  passphrase: string,
): Promise<void> {
  ensureKeysDir();
  const encrypted = encrypt(privateKey, passphrase);
  writeFileSync(keyPath(handle), encrypted, { mode: 0o600 });
}

export async function deleteKey(handle: string): Promise<void> {
  const path = keyPath(handle);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
