import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, scryptSync, createCipheriv } from "node:crypto";

// We'll override the keys directory for testing by setting env vars BEFORE importing.
const TEST_DIR = join(
  tmpdir(),
  `maverick-keys-test-${randomBytes(8).toString("hex")}`,
);

// Force file-only mode (no keychain in tests) and use our test directory
process.env.__MAVERICK_KEYS_DIR = TEST_DIR;
process.env.__MAVERICK_KEYRING_DISABLE = "1";

// Now import AFTER setting the env vars
import {
  storeKey,
  getStoredKey,
  deleteKey,
  decryptLegacyKey,
  migrateLegacyKey,
  hasLegacyKeyFile,
  _resetKeyringCache,
} from "../src/storage/keys.js";

// Helper: create an old-format encrypted key file (AES-256-GCM with scrypt KDF)
function createLegacyEncryptedFile(
  handle: string,
  privateKey: string,
  passphrase: string,
): string {
  const safe = handle.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(TEST_DIR, `${safe}.key`);

  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  }) as Buffer;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const json = JSON.stringify({
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    encrypted: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  });

  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(filePath, json, { mode: 0o600 });
  return filePath;
}

describe("key storage (new API — no passphrase)", () => {
  const testHandle = "alice.bsky.social";
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  beforeEach(() => {
    _resetKeyringCache();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("storeKey + getStoredKey roundtrip", async () => {
    await storeKey(testHandle, testKey);
    const retrieved = await getStoredKey(testHandle);
    expect(retrieved).toBe(testKey);
  });

  it("stored key IS plaintext on disk (new security model)", async () => {
    await storeKey(testHandle, testKey);

    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const raw = readFileSync(filePath, "utf-8").trim();

    // New model: plaintext hex, same as ~/.ssh/id_ed25519
    expect(raw).toBe(testKey);
  });

  it("file is written with 0600 permissions", async () => {
    await storeKey(testHandle, testKey);

    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const { statSync } = await import("node:fs");
    const stats = statSync(filePath);
    // 0o600 = owner read+write only (octal 33152 with file type bits, mask to lower 9)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null for a nonexistent handle", async () => {
    const result = await getStoredKey("nonexistent.handle");
    expect(result).toBeNull();
  });

  it("deleteKey removes the file", async () => {
    await storeKey(testHandle, testKey);

    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    expect(existsSync(filePath)).toBe(true);

    await deleteKey(testHandle);
    expect(existsSync(filePath)).toBe(false);
  });

  it("getStoredKey returns null after deleteKey", async () => {
    await storeKey(testHandle, testKey);
    await deleteKey(testHandle);
    const result = await getStoredKey(testHandle);
    expect(result).toBeNull();
  });

  it("storeKey overwrites existing key", async () => {
    const newKey =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    await storeKey(testHandle, testKey);
    await storeKey(testHandle, newKey);
    const retrieved = await getStoredKey(testHandle);
    expect(retrieved).toBe(newKey);
  });

  it("handles special characters in handle via sanitization", async () => {
    const weirdHandle = "user@domain/with:special!chars";
    await storeKey(weirdHandle, testKey);
    const retrieved = await getStoredKey(weirdHandle);
    expect(retrieved).toBe(testKey);
  });
});

describe("legacy key migration", () => {
  const testHandle = "legacy-user.bsky.social";
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const passphrase = "old-bluesky-app-password";

  beforeEach(() => {
    _resetKeyringCache();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("decryptLegacyKey reads old encrypted format", async () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);
    const decrypted = await decryptLegacyKey(testHandle, passphrase);
    expect(decrypted).toBe(testKey);
  });

  it("decryptLegacyKey returns null with wrong passphrase", async () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);
    const decrypted = await decryptLegacyKey(testHandle, "wrong-password");
    expect(decrypted).toBeNull();
  });

  it("decryptLegacyKey returns null for nonexistent file", async () => {
    const decrypted = await decryptLegacyKey("nobody.bsky.social", passphrase);
    expect(decrypted).toBeNull();
  });

  it("hasLegacyKeyFile detects encrypted JSON format", () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);
    expect(hasLegacyKeyFile(testHandle)).toBe(true);
  });

  it("hasLegacyKeyFile returns false for plaintext key file", async () => {
    await storeKey(testHandle, testKey);
    expect(hasLegacyKeyFile(testHandle)).toBe(false);
  });

  it("hasLegacyKeyFile returns false when no file exists", () => {
    expect(hasLegacyKeyFile("nobody.bsky.social")).toBe(false);
  });

  it("migrateLegacyKey decrypts and re-stores in new format", async () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);

    // Migrate
    const result = await migrateLegacyKey(testHandle, passphrase);
    expect(result).toBe(testKey);

    // Should now be readable without a passphrase
    const retrieved = await getStoredKey(testHandle);
    expect(retrieved).toBe(testKey);

    // File should now be plaintext, not encrypted JSON
    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const raw = readFileSync(filePath, "utf-8").trim();
    expect(raw).toBe(testKey);
    expect(raw.startsWith("{")).toBe(false);
  });

  it("migrateLegacyKey returns null with wrong passphrase", async () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);

    const result = await migrateLegacyKey(testHandle, "wrong-password");
    expect(result).toBeNull();

    // Original encrypted file should still be intact
    expect(hasLegacyKeyFile(testHandle)).toBe(true);
  });

  it("getStoredKey does NOT read legacy encrypted files", async () => {
    createLegacyEncryptedFile(testHandle, testKey, passphrase);

    // The new getStoredKey (no passphrase) should NOT return the encrypted key
    const result = await getStoredKey(testHandle);
    expect(result).toBeNull();
  });
});
