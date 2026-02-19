import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createCipheriv, scryptSync, randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { storeKey, getStoredKey, deleteKey, _resetKeyringCache } from "../src/storage/keys.js";
import {
  generateDbEncryptionKey,
  getCachedPrivateKey,
  createNewIdentity,
  commitIdentity,
  recoverIdentity,
  importRawKey,
  migrateLegacyIdentity,
} from "../src/identity/xmtp.js";
import { derivePrivateKey } from "../src/identity/recovery-phrase.js";

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

  it("stores and retrieves a key", async () => {
    await storeKey(testHandle, testKey);
    const retrieved = await getStoredKey(testHandle);
    expect(retrieved).toBe(testKey);
  });

  it("returns null for missing key", async () => {
    const result = await getStoredKey("nonexistent.handle");
    expect(result).toBeNull();
  });

  it("deletes a key", async () => {
    await storeKey(testHandle, testKey);
    await deleteKey(testHandle);
    const result = await getStoredKey(testHandle);
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

// ── New identity flow tests ────────────────────────────────────────────────

describe("XMTP identity flow", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `maverick-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.__MAVERICK_KEYS_DIR = tempDir;
    process.env.__MAVERICK_KEYRING_DISABLE = "1";
    _resetKeyringCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.__MAVERICK_KEYS_DIR;
    delete process.env.__MAVERICK_KEYRING_DISABLE;
    _resetKeyringCache();
  });

  const testHandle = "alice.bsky.social";
  const testDid = "did:plc:alice123456";
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;

  describe("getCachedPrivateKey", () => {
    it("returns null when no key is stored", async () => {
      const result = await getCachedPrivateKey(testHandle);
      expect(result).toBeNull();
    });

    it("returns cached key after storeKey", async () => {
      await storeKey(testHandle, testKey);
      const result = await getCachedPrivateKey(testHandle);
      expect(result).toBe(testKey);
    });

    it("returns key as 0x-prefixed hex string", async () => {
      await storeKey(testHandle, testKey);
      const result = await getCachedPrivateKey(testHandle);
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe("createNewIdentity", () => {
    it("returns a recovery phrase and private key", async () => {
      const result = await createNewIdentity(testHandle, testDid);
      expect(result.recoveryPhrase).toBeDefined();
      expect(result.privateKey).toBeDefined();
    });

    it("recovery phrase has 6 words", async () => {
      const { recoveryPhrase } = await createNewIdentity(testHandle, testDid);
      const words = recoveryPhrase.split(" ");
      expect(words).toHaveLength(6);
    });

    it("private key is a valid 0x-prefixed hex string", async () => {
      const { privateKey } = await createNewIdentity(testHandle, testDid);
      expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("does NOT cache the key until commitIdentity is called", async () => {
      const { privateKey } = await createNewIdentity(testHandle, testDid);
      // Key must not be persisted before the user confirms the recovery phrase
      expect(await getCachedPrivateKey(testHandle)).toBeNull();

      await commitIdentity(testHandle, privateKey);
      expect(await getCachedPrivateKey(testHandle)).toBe(privateKey);
    });

    it("the private key matches what derivePrivateKey produces from the phrase", async () => {
      const { recoveryPhrase, privateKey } = await createNewIdentity(
        testHandle,
        testDid,
      );
      const rederived = derivePrivateKey(recoveryPhrase, testDid);
      expect(rederived).toBe(privateKey);
    });

    it("generates different phrases on subsequent calls", async () => {
      const r1 = await createNewIdentity("handle1.bsky.social", testDid);
      const r2 = await createNewIdentity("handle2.bsky.social", testDid);
      expect(r1.recoveryPhrase).not.toBe(r2.recoveryPhrase);
    });
  });

  describe("recoverIdentity", () => {
    it("derives the same key as createNewIdentity for the same phrase+DID", async () => {
      const { recoveryPhrase, privateKey: original } =
        await createNewIdentity(testHandle, testDid);

      // Delete the cached key
      await deleteKey(testHandle);
      expect(await getCachedPrivateKey(testHandle)).toBeNull();

      // Recover
      const recovered = await recoverIdentity(
        testHandle,
        testDid,
        recoveryPhrase,
      );
      expect(recovered).toBe(original);
    });

    it("does NOT cache the key (callers must store after verification)", async () => {
      const { recoveryPhrase } =
        await createNewIdentity(testHandle, testDid);

      await deleteKey(testHandle);
      expect(await getCachedPrivateKey(testHandle)).toBeNull();

      await recoverIdentity(testHandle, testDid, recoveryPhrase);

      // Key must NOT be persisted — recoverIdentity only derives
      const cached = await getCachedPrivateKey(testHandle);
      expect(cached).toBeNull();
    });

    it("returns the derived key without side effects", async () => {
      const { recoveryPhrase, privateKey: original } =
        await createNewIdentity(testHandle, testDid);

      await deleteKey(testHandle);

      const recovered = await recoverIdentity(
        testHandle,
        testDid,
        recoveryPhrase,
      );

      // Returns correct key
      expect(recovered).toBe(original);
      // No side effects — nothing stored
      expect(await getCachedPrivateKey(testHandle)).toBeNull();
    });

    it("wrong phrase does not leave a cached key", async () => {
      await createNewIdentity(testHandle, testDid);
      await deleteKey(testHandle);

      // Use a wrong phrase — should still not store anything
      const wrongKey = await recoverIdentity(
        testHandle,
        testDid,
        "wrong wrong wrong wrong wrong wrong",
      );
      // Returns a key (derived from the wrong phrase), but does NOT cache it
      expect(wrongKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(await getCachedPrivateKey(testHandle)).toBeNull();
    });

    it("produces a valid 0x-prefixed hex key", async () => {
      const { recoveryPhrase } = await createNewIdentity(testHandle, testDid);
      await deleteKey(testHandle);

      const key = await recoverIdentity(testHandle, testDid, recoveryPhrase);
      expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("produces different keys for different DIDs with the same phrase", async () => {
      const { recoveryPhrase } = await createNewIdentity(testHandle, testDid);
      await deleteKey(testHandle);

      const key1 = await recoverIdentity(testHandle, testDid, recoveryPhrase);
      const key2 = await recoverIdentity(
        "other.bsky.social",
        "did:plc:other789",
        recoveryPhrase,
      );
      expect(key1).not.toBe(key2);
    });

    it("caller can store key after external verification succeeds", async () => {
      const { recoveryPhrase, privateKey: original } =
        await createNewIdentity(testHandle, testDid);

      await deleteKey(testHandle);

      const recovered = await recoverIdentity(
        testHandle,
        testDid,
        recoveryPhrase,
      );
      // Simulate caller verifying the key (e.g. createXmtpClient succeeds)
      // then explicitly storing it
      await commitIdentity(testHandle, recovered);

      const cached = await getCachedPrivateKey(testHandle);
      expect(cached).toBe(original);
    });
  });

  describe("importRawKey", () => {
    it("stores the key so it can be retrieved", async () => {
      await importRawKey(testHandle, testKey);
      const cached = await getCachedPrivateKey(testHandle);
      expect(cached).toBe(testKey);
    });

    it("overwrites a previously stored key", async () => {
      const otherKey =
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`;

      await importRawKey(testHandle, testKey);
      await importRawKey(testHandle, otherKey);

      const cached = await getCachedPrivateKey(testHandle);
      expect(cached).toBe(otherKey);
    });
  });

  describe("migrateLegacyIdentity", () => {
    const passphrase = "old-bluesky-password";

    /** Write a legacy encrypted key file in the old JSON format */
    function writeLegacyKeyFile(handle: string, key: string, pass: string) {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const derived = scryptSync(pass, salt, 32, {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      }) as Buffer;
      const cipher = createCipheriv("aes-256-gcm", derived, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(key, "utf-8")),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      const json = JSON.stringify({
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        encrypted: encrypted.toString("base64"),
        tag: tag.toString("base64"),
      });

      const safe = handle.replace(/[^a-zA-Z0-9._-]/g, "_");
      writeFileSync(join(tempDir, `${safe}.key`), json, { mode: 0o600 });
    }

    it("decrypts and migrates a legacy key file", async () => {
      writeLegacyKeyFile(testHandle, testKey, passphrase);

      const result = await migrateLegacyIdentity(testHandle, passphrase);
      expect(result).toBe(testKey);
    });

    it("caches the migrated key for getCachedPrivateKey", async () => {
      writeLegacyKeyFile(testHandle, testKey, passphrase);
      await migrateLegacyIdentity(testHandle, passphrase);

      const cached = await getCachedPrivateKey(testHandle);
      expect(cached).toBe(testKey);
    });

    it("replaces the encrypted file with plaintext format", async () => {
      writeLegacyKeyFile(testHandle, testKey, passphrase);
      await migrateLegacyIdentity(testHandle, passphrase);

      const safe = testHandle.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileContent = readFileSync(
        join(tempDir, `${safe}.key`),
        "utf-8",
      ).trim();
      // New format is plaintext hex, not JSON
      expect(fileContent.startsWith("0x")).toBe(true);
      expect(fileContent.includes("{")).toBe(false);
    });

    it("returns null when no legacy file exists", async () => {
      const result = await migrateLegacyIdentity(testHandle, passphrase);
      expect(result).toBeNull();
    });

    it("returns null with wrong passphrase", async () => {
      writeLegacyKeyFile(testHandle, testKey, passphrase);

      const result = await migrateLegacyIdentity(testHandle, "wrong-password");
      expect(result).toBeNull();
    });
  });
});
