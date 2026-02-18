import { Entry } from "@napi-rs/keyring";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createDecipheriv, scryptSync } from "node:crypto";

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

const SERVICE = "maverick";

// ── Directory + path helpers ─────────────────────────────────────────────

function getKeysDir(): string {
  if (process.env.__MAVERICK_KEYS_DIR) {
    return process.env.__MAVERICK_KEYS_DIR;
  }
  return join(homedir(), ".maverick", "keys");
}

function ensureKeysDir(): void {
  mkdirSync(getKeysDir(), { recursive: true });
}

function sanitizeHandle(handle: string): string {
  return handle.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function keyPath(handle: string): string {
  return join(getKeysDir(), `${sanitizeHandle(handle)}.key`);
}

function keyringAccount(handle: string): string {
  return `xmtp-key-${sanitizeHandle(handle)}`;
}

// ── Keyring backend ──────────────────────────────────────────────────────

// Persist keyring availability across process restarts to avoid probing the
// OS keychain on every cold start (which can trigger unlock prompts).
// Cache file: <keysDir>/.keyring_ok  — "1" available, "0" unavailable.

function keyringCachePath(): string {
  return join(getKeysDir(), ".keyring_ok");
}

function readKeyringCache(): boolean | null {
  try {
    const raw = readFileSync(keyringCachePath(), "utf-8").trim();
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeKeyringCache(available: boolean): void {
  try {
    ensureKeysDir();
    writeFileSync(keyringCachePath(), available ? "1" : "0", { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

function keyringAvailable(): boolean {
  if (process.env.__MAVERICK_KEYRING_DISABLE === "1") {
    return false;
  }

  // Check file cache before touching the OS keychain
  const cached = readKeyringCache();
  if (cached !== null) {
    return cached;
  }

  // First run: probe once, then persist the result
  try {
    const probe = new Entry(SERVICE, "__probe__");
    probe.setPassword("ok");
    probe.deletePassword();
    writeKeyringCache(true);
    return true;
  } catch {
    writeKeyringCache(false);
    return false;
  }
}

let _keyringOk: boolean | undefined;
let _warnedFallback = false;

function useKeyring(): boolean {
  if (_keyringOk === undefined) {
    _keyringOk = keyringAvailable();
  }
  return _keyringOk;
}

function warnFallback(): void {
  if (_warnedFallback) return;
  _warnedFallback = true;
  console.warn(
    `[maverick] OS keychain unavailable — XMTP keys saved to ${getKeysDir()}/ (mode 0600)`,
  );
}

/** Reset cached keyring state. Only for testing. */
export function _resetKeyringCache(): void {
  _keyringOk = undefined;
  _warnedFallback = false;
  // Also remove the on-disk cache so probe re-runs in the next test
  try { unlinkSync(keyringCachePath()); } catch { /* may not exist */ }
}

function saveToKeyring(handle: string, key: string): void {
  new Entry(SERVICE, keyringAccount(handle)).setPassword(key);
}

function loadFromKeyring(handle: string): string | null {
  try {
    const val = new Entry(SERVICE, keyringAccount(handle)).getPassword();
    return val || null;
  } catch {
    return null;
  }
}

function clearKeyring(handle: string): void {
  try {
    new Entry(SERVICE, keyringAccount(handle)).deletePassword();
  } catch {
    /* may not exist */
  }
}

// ── File backend (plaintext, 0600) ───────────────────────────────────────

function saveToFile(handle: string, key: string): void {
  ensureKeysDir();
  writeFileSync(keyPath(handle), key, { mode: 0o600 });
}

function loadFromFile(handle: string): string | null {
  const path = keyPath(handle);
  try {
    const raw = readFileSync(path, "utf-8").trim();
    // Only accept raw hex keys (new plaintext format) — not encrypted JSON
    if (raw.startsWith("0x") && !raw.includes("{")) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function clearFile(handle: string): void {
  const path = keyPath(handle);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// ── Legacy decryption (old passphrase-encrypted format) ──────────────────

const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS) as Buffer;
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
 * Retrieve the stored XMTP private key for a handle.
 * Tries keychain first (faster, more secure), then plaintext file fallback.
 * Returns null if no key is stored.
 */
export async function getStoredKey(handle: string): Promise<string | null> {
  // Try keychain first
  if (useKeyring()) {
    const fromKeyring = loadFromKeyring(handle);
    if (fromKeyring) {
      return fromKeyring;
    }
  }

  // Fall back to plaintext file
  const fromFile = loadFromFile(handle);
  if (fromFile) {
    // Opportunistically populate keychain if available
    if (useKeyring()) {
      try {
        saveToKeyring(handle, fromFile);
      } catch {
        /* best effort */
      }
    }
    return fromFile;
  }

  return null;
}

/**
 * Store an XMTP private key for a handle.
 * Writes to both keychain and plaintext 0600 file for redundancy.
 */
export async function storeKey(
  handle: string,
  privateKey: string,
): Promise<void> {
  // Write to keychain
  if (useKeyring()) {
    saveToKeyring(handle, privateKey);
  } else {
    warnFallback();
  }

  // Always write file fallback
  saveToFile(handle, privateKey);
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
  clearFile(handle);
  await storeKey(handle, decrypted);
  return decrypted;
}

/**
 * Delete the stored key from all backends (keychain + file).
 */
export async function deleteKey(handle: string): Promise<void> {
  if (useKeyring()) {
    clearKeyring(handle);
  }
  clearFile(handle);
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
