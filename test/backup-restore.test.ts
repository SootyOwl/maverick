import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// Force file-only mode for key storage in tests
const TEST_DIR = join(
  tmpdir(),
  `maverick-backup-test-${randomBytes(8).toString("hex")}`,
);
process.env.__MAVERICK_KEYS_DIR = join(TEST_DIR, "keys");
process.env.__MAVERICK_KEYRING_DISABLE = "1";

import { storeKey, getStoredKey, _resetKeyringCache } from "../src/storage/keys.js";

// ── Helpers that mirror the backup/restore logic in index.ts ────────────

const SCRYPT_OPTS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** Build a v2 backup (old format, no private key). */
function buildV2Backup(
  xmtpDb: Buffer,
  maverickDb: Buffer,
  passphrase: string,
): Buffer {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(xmtpDb.length, 0);
  const plaintext = Buffer.concat([sizeBuf, xmtpDb, maverickDb]);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const header = JSON.stringify({
    version: 2,
    createdAt: new Date().toISOString(),
    xmtpDbSize: xmtpDb.length,
    maverickDbSize: maverickDb.length,
  });
  const headerBuf = Buffer.from(header + "\n", "utf-8");
  const headerLenBuf = Buffer.alloc(4);
  headerLenBuf.writeUInt32LE(headerBuf.length, 0);

  return Buffer.concat([headerLenBuf, headerBuf, salt, iv, authTag, encrypted]);
}

/** Build a v3 backup (new format, includes private key). */
function buildV3Backup(
  xmtpDb: Buffer,
  maverickDb: Buffer,
  privateKey: string,
  passphrase: string,
): Buffer {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  // v3 payload: [4B xmtpDbSize] [xmtpDb] [4B maverickDbSize] [maverickDb] [privateKey UTF-8]
  const xmtpSizeBuf = Buffer.alloc(4);
  xmtpSizeBuf.writeUInt32LE(xmtpDb.length, 0);
  const mavSizeBuf = Buffer.alloc(4);
  mavSizeBuf.writeUInt32LE(maverickDb.length, 0);
  const keyBuf = Buffer.from(privateKey, "utf-8");
  const plaintext = Buffer.concat([
    xmtpSizeBuf,
    xmtpDb,
    mavSizeBuf,
    maverickDb,
    keyBuf,
  ]);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const header = JSON.stringify({
    version: 3,
    createdAt: new Date().toISOString(),
    xmtpDbSize: xmtpDb.length,
    maverickDbSize: maverickDb.length,
    privateKeyIncluded: true,
  });
  const headerBuf = Buffer.from(header + "\n", "utf-8");
  const headerLenBuf = Buffer.alloc(4);
  headerLenBuf.writeUInt32LE(headerBuf.length, 0);

  return Buffer.concat([headerLenBuf, headerBuf, salt, iv, authTag, encrypted]);
}

/** Decrypt a backup and parse the payload according to version. */
function decryptBackup(
  data: Buffer,
  passphrase: string,
): {
  header: Record<string, unknown>;
  xmtpDb: Buffer;
  maverickDb: Buffer;
  privateKey: string | null;
} {
  let offset = 0;

  const headerLen = data.readUInt32LE(offset);
  offset += 4;
  const headerStr = data.subarray(offset, offset + headerLen).toString("utf-8").trim();
  offset += headerLen;
  const header = JSON.parse(headerStr);

  const ivSize = header.version === 1 ? 16 : 12;
  const salt = data.subarray(offset, offset + 32);
  offset += 32;
  const iv = data.subarray(offset, offset + ivSize);
  offset += ivSize;
  const authTag = data.subarray(offset, offset + 16);
  offset += 16;
  const encrypted = data.subarray(offset);

  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  if (header.version >= 3) {
    // v3 format: [4B xmtpDbSize] [xmtpDb] [4B maverickDbSize] [maverickDb] [privateKey]
    let pOff = 0;
    const xmtpDbSize = plaintext.readUInt32LE(pOff);
    pOff += 4;
    const xmtpDb = plaintext.subarray(pOff, pOff + xmtpDbSize);
    pOff += xmtpDbSize;
    const maverickDbSize = plaintext.readUInt32LE(pOff);
    pOff += 4;
    const maverickDb = plaintext.subarray(pOff, pOff + maverickDbSize);
    pOff += maverickDbSize;
    const privateKey = plaintext.subarray(pOff).toString("utf-8");
    return { header, xmtpDb, maverickDb, privateKey: privateKey || null };
  } else {
    // v1/v2 format: [4B xmtpDbSize] [xmtpDb] [maverickDb]
    const xmtpDbSize = plaintext.readUInt32LE(0);
    const xmtpDb = plaintext.subarray(4, 4 + xmtpDbSize);
    const maverickDb = plaintext.subarray(4 + xmtpDbSize);
    return { header, xmtpDb, maverickDb, privateKey: null };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("backup payload serialization", () => {
  const passphrase = "test-passphrase-12345";
  const xmtpDb = Buffer.from("fake-xmtp-database-content");
  const maverickDb = Buffer.from("fake-maverick-database-content");
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  it("v3 backup round-trips all three components", () => {
    const backup = buildV3Backup(xmtpDb, maverickDb, privateKey, passphrase);
    const result = decryptBackup(backup, passphrase);

    expect(Buffer.from(result.xmtpDb).equals(xmtpDb)).toBe(true);
    expect(Buffer.from(result.maverickDb).equals(maverickDb)).toBe(true);
    expect(result.privateKey).toBe(privateKey);
    expect(result.header.version).toBe(3);
    expect(result.header.privateKeyIncluded).toBe(true);
  });

  it("v3 backup with empty maverick DB", () => {
    const emptyMav = Buffer.alloc(0);
    const backup = buildV3Backup(xmtpDb, emptyMav, privateKey, passphrase);
    const result = decryptBackup(backup, passphrase);

    expect(Buffer.from(result.xmtpDb).equals(xmtpDb)).toBe(true);
    expect(result.maverickDb.length).toBe(0);
    expect(result.privateKey).toBe(privateKey);
  });

  it("v2 backup (old format) decrypts without private key", () => {
    const backup = buildV2Backup(xmtpDb, maverickDb, passphrase);
    const result = decryptBackup(backup, passphrase);

    expect(Buffer.from(result.xmtpDb).equals(xmtpDb)).toBe(true);
    expect(Buffer.from(result.maverickDb).equals(maverickDb)).toBe(true);
    expect(result.privateKey).toBeNull();
    expect(result.header.version).toBe(2);
  });

  it("wrong passphrase throws on decrypt", () => {
    const backup = buildV3Backup(xmtpDb, maverickDb, privateKey, passphrase);
    expect(() => decryptBackup(backup, "wrong-passphrase")).toThrow();
  });
});

describe("backup/restore round-trip with key storage", () => {
  const testHandle = "backup-test.bsky.social";
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const passphrase = "strong-backup-pass";

  beforeEach(() => {
    _resetKeyringCache();
    mkdirSync(join(TEST_DIR, "keys"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("v3 restore writes private key to storage", async () => {
    // Simulate: backup includes the key, then we restore and check storage
    const xmtpDb = Buffer.from("xmtp-data");
    const maverickDb = Buffer.from("maverick-data");
    const backup = buildV3Backup(xmtpDb, maverickDb, privateKey, passphrase);
    const result = decryptBackup(backup, passphrase);

    // Simulate restore storing the key
    expect(result.privateKey).toBe(privateKey);
    await storeKey(testHandle, result.privateKey!);

    // Verify key is retrievable
    const stored = await getStoredKey(testHandle);
    expect(stored).toBe(privateKey);
  });

  it("v2 restore works without private key (backwards compat)", async () => {
    const xmtpDb = Buffer.from("xmtp-data");
    const maverickDb = Buffer.from("maverick-data");
    const backup = buildV2Backup(xmtpDb, maverickDb, passphrase);
    const result = decryptBackup(backup, passphrase);

    // No private key in v2 backups
    expect(result.privateKey).toBeNull();

    // Databases still extracted correctly
    expect(Buffer.from(result.xmtpDb).toString()).toBe("xmtp-data");
    expect(Buffer.from(result.maverickDb).toString()).toBe("maverick-data");
  });

  it("private key survives full backup → clear → restore cycle", async () => {
    // 1. Store key
    await storeKey(testHandle, privateKey);
    expect(await getStoredKey(testHandle)).toBe(privateKey);

    // 2. Read key for backup
    const storedKey = await getStoredKey(testHandle);
    expect(storedKey).toBe(privateKey);

    // 3. Create backup
    const xmtpDb = Buffer.from("xmtp-data");
    const maverickDb = Buffer.from("maverick-data");
    const backup = buildV3Backup(xmtpDb, maverickDb, storedKey!, passphrase);

    // 4. Clear all keys (simulate reauth / delete data dir)
    const { deleteKey } = await import("../src/storage/keys.js");
    await deleteKey(testHandle);
    expect(await getStoredKey(testHandle)).toBeNull();

    // 5. Restore from backup
    const result = decryptBackup(backup, passphrase);
    expect(result.privateKey).toBe(privateKey);
    await storeKey(testHandle, result.privateKey!);

    // 6. Key is back
    expect(await getStoredKey(testHandle)).toBe(privateKey);
  });
});
