import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { storeKey, getStoredKey, deleteKey } from "../src/storage/keys.js";
import { generateDbEncryptionKey } from "../src/identity/xmtp.js";

describe("config", () => {
  it("loads config with defaults", () => {
    const config = loadConfig();
    expect(config.xmtp.env).toBe("dev");
    expect(config.dataDir).toContain(".maverick");
    expect(config.bluesky.pdsUrl).toBe("https://bsky.social");
  });
});

describe("key storage", () => {
  const testHandle = "test-handle.bsky.social";
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const passphrase = "test-passphrase";

  it("stores and retrieves a key", async () => {
    await storeKey(testHandle, testKey, passphrase);
    const retrieved = await getStoredKey(testHandle, passphrase);
    expect(retrieved).toBe(testKey);
  });

  it("returns null for missing key", async () => {
    const result = await getStoredKey("nonexistent.handle", passphrase);
    expect(result).toBeNull();
  });

  it("deletes a key", async () => {
    await storeKey(testHandle, testKey, passphrase);
    await deleteKey(testHandle);
    const result = await getStoredKey(testHandle, passphrase);
    expect(result).toBeNull();
  });
});

describe("DB encryption key derivation", () => {
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  it("produces a 32-byte key", () => {
    const dbKey = generateDbEncryptionKey(testKey);
    expect(dbKey).toBeInstanceOf(Uint8Array);
    expect(dbKey.length).toBe(32);
  });

  it("does NOT equal the raw private key bytes", () => {
    const dbKey = generateDbEncryptionKey(testKey);
    // Raw private key bytes (what the old implementation returned)
    const hex = testKey.slice(2);
    const rawBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      rawBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    // The derived key must be DIFFERENT from the raw private key
    expect(Buffer.from(dbKey).equals(Buffer.from(rawBytes))).toBe(false);
  });

  it("is deterministic for the same input", () => {
    const key1 = generateDbEncryptionKey(testKey);
    const key2 = generateDbEncryptionKey(testKey);
    expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
  });
});
