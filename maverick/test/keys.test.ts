import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// We'll override the keys directory for testing by importing the module
// and using a custom data dir. We need to set the env var BEFORE importing.
const TEST_DIR = join(
  tmpdir(),
  `maverick-keys-test-${randomBytes(8).toString("hex")}`,
);

// Set the env var so keys.ts uses our test directory
process.env.__MAVERICK_KEYS_DIR = TEST_DIR;

// Now import AFTER setting the env var
import { storeKey, getStoredKey, deleteKey } from "../src/storage/keys.js";

describe("encrypted key storage", () => {
  const testHandle = "alice.bsky.social";
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const passphrase = "test-app-password-1234";

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("stored key is NOT plaintext on disk", async () => {
    await storeKey(testHandle, testKey, passphrase);

    // Find the key file and read raw contents
    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const raw = readFileSync(filePath, "utf-8");

    // The raw hex key should NOT appear in the file
    expect(raw).not.toContain(testKey);
    // The key without 0x prefix should also not appear
    expect(raw).not.toContain(testKey.slice(2));
  });

  it("storeKey + getStoredKey roundtrip with correct passphrase", async () => {
    await storeKey(testHandle, testKey, passphrase);
    const retrieved = await getStoredKey(testHandle, passphrase);
    expect(retrieved).toBe(testKey);
  });

  it("getStoredKey with wrong passphrase returns null", async () => {
    await storeKey(testHandle, testKey, passphrase);
    const retrieved = await getStoredKey(testHandle, "wrong-password");
    expect(retrieved).toBeNull();
  });

  it("stored file contains salt, iv, encrypted, and tag fields", async () => {
    await storeKey(testHandle, testKey, passphrase);

    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty("salt");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("encrypted");
    expect(parsed).toHaveProperty("tag");

    // All values should be base64 strings
    expect(typeof parsed.salt).toBe("string");
    expect(typeof parsed.iv).toBe("string");
    expect(typeof parsed.encrypted).toBe("string");
    expect(typeof parsed.tag).toBe("string");

    // They should be non-empty
    expect(parsed.salt.length).toBeGreaterThan(0);
    expect(parsed.iv.length).toBeGreaterThan(0);
    expect(parsed.encrypted.length).toBeGreaterThan(0);
    expect(parsed.tag.length).toBeGreaterThan(0);
  });

  it("deleteKey removes the file", async () => {
    await storeKey(testHandle, testKey, passphrase);

    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    expect(existsSync(filePath)).toBe(true);

    await deleteKey(testHandle);
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns null for a nonexistent handle", async () => {
    const result = await getStoredKey("nonexistent.handle", passphrase);
    expect(result).toBeNull();
  });

  it("different passphrases produce different ciphertext", async () => {
    await storeKey(testHandle, testKey, "password-one");
    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const raw1 = readFileSync(filePath, "utf-8");

    await storeKey(testHandle, testKey, "password-two");
    const raw2 = readFileSync(filePath, "utf-8");

    // Due to random salt + IV, ciphertext should differ
    expect(raw1).not.toBe(raw2);
  });

  it("migrates a legacy plaintext key file", async () => {
    // Simulate a legacy plaintext key file
    const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(TEST_DIR, `${safe}.key`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, testKey, { mode: 0o600 });

    // Reading with passphrase should detect plaintext, return the key, and migrate
    const retrieved = await getStoredKey(testHandle, passphrase);
    expect(retrieved).toBe(testKey);

    // After migration, the file should now be encrypted (JSON, not plaintext)
    const rawAfter = readFileSync(filePath, "utf-8");
    expect(rawAfter.startsWith("{")).toBe(true);
    expect(rawAfter).not.toContain(testKey);

    // Should still be retrievable with the same passphrase
    const retrievedAgain = await getStoredKey(testHandle, passphrase);
    expect(retrievedAgain).toBe(testKey);
  });
});
