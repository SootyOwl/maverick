import {
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createDecipheriv, scryptSync } from "node:crypto";
import { SCRYPT_PARAMS } from "../utils/crypto-constants.js";
import { KeychainStrategy } from "./keychain-strategy.js";

// Key storage with OS keychain (primary) + plaintext 0600 file (fallback).
//
// The old system encrypted keys with the Bluesky app password via scrypt.
// The new system caches keys in the OS keychain with a plaintext 0600 file
// fallback — same security model as ~/.ssh/id_ed25519.
//
// This decouples key storage from the Bluesky password. The key itself is
// derived from the recovery phrase (handled by recovery-phrase.ts).
//
// File location: ~/.maverick/keys/<handle>.key
// Keychain account: "xmtp-key-<sanitized_handle>"
//
// Override via __MAVERICK_KEYS_DIR for testing (file backend only).
// Override via __MAVERICK_KEYRING_DISABLE=1 to force file-only mode in tests.

// ── Directory + path helpers ─────────────────────────────────────────────

function getKeysDir(): string {
  if (process.env.__MAVERICK_KEYS_DIR) {
    return process.env.__MAVERICK_KEYS_DIR;
  }
  return join(homedir(), ".maverick", "keys");
}

function sanitizeHandle(handle: string): string {
  return handle.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function keyPath(handle: string): string {
  return join(getKeysDir(), `${sanitizeHandle(handle)}.key`);
}

// ── Strategy instance ────────────────────────────────────────────────────
//
// The logical "account" passed to save/load/delete is the raw handle.
// keyringAccount maps it to "xmtp-key-<sanitized>" for the OS keychain.
// filePath maps it to ~/.maverick/keys/<sanitized>.key.

const strategy = new KeychainStrategy({
  service: "maverick",
  filePath: (handle: string) => keyPath(handle),
  keyringAccount: (handle: string) => `xmtp-key-${sanitizeHandle(handle)}`,
  cacheDir: getKeysDir,
  fallbackLabel: `XMTP keys`,
  fileValidator: (raw: string) => {
    // Only accept raw hex keys (new plaintext format) — not encrypted JSON
    if (raw.startsWith("0x") && !raw.includes("{")) {
      return raw;
    }
    return null;
  },
});

// ── Legacy decryption (old passphrase-encrypted format) ──────────────────

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_PARAMS.keyLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  }) as Buffer;
}

function decryptEncrypted(stored: string, passphrase: string): string | null {
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

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Reset cached keyring state. Only for testing.
 */
export function _resetKeyringCache(): void {
  strategy._reset();
}

/**
 * Retrieve the stored XMTP private key for a handle.
 * Tries keychain first (faster, more secure), then plaintext file fallback.
 * Returns null if no key is stored.
 */
export async function getStoredKey(handle: string): Promise<string | null> {
  return strategy.load(handle);
}

/**
 * Store an XMTP private key for a handle.
 * Writes to both keychain and plaintext 0600 file for redundancy.
 */
export async function storeKey(
  handle: string,
  privateKey: string,
): Promise<void> {
  strategy.save(handle, privateKey);
}

/**
 * Delete the stored key from all backends (keychain + file).
 */
export async function deleteKey(handle: string): Promise<void> {
  strategy.delete(handle);
}

/**
 * Decrypt a legacy passphrase-encrypted key file.
 * Returns the decrypted key or null if decryption fails / no file exists.
 * Does NOT migrate the key — call migrateLegacyKey() for that.
 */
export async function decryptLegacyKey(
  handle: string,
  passphrase: string,
): Promise<string | null> {
  const path = keyPath(handle);
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (raw.startsWith("{")) {
      return decryptEncrypted(raw, passphrase);
    }
    // If it's already plaintext hex, return it directly
    if (raw.startsWith("0x")) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Migrate a legacy passphrase-encrypted key to the new storage system.
 * Reads the old encrypted file, decrypts with passphrase, stores via new
 * storeKey (keychain + plaintext file), and deletes the old encrypted file
 * before writing the new one.
 *
 * Returns the decrypted key on success, null on failure.
 */
export async function migrateLegacyKey(
  handle: string,
  passphrase: string,
): Promise<string | null> {
  const decrypted = await decryptLegacyKey(handle, passphrase);
  if (!decrypted) {
    return null;
  }

  // Delete old file then store in new format
  strategy.delete(handle);
  await storeKey(handle, decrypted);
  return decrypted;
}

/**
 * Check if a legacy (encrypted JSON) key file exists for a handle.
 */
export function hasLegacyKeyFile(handle: string): boolean {
  const path = keyPath(handle);
  try {
    const raw = readFileSync(path, "utf-8").trim();
    return raw.startsWith("{");
  } catch {
    return false;
  }
}
