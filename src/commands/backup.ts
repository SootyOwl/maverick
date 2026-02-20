import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { getCachedPrivateKey } from "../identity/xmtp.js";
import { encrypt, decrypt, IV_SIZE_V1, IV_SIZE_V2 } from "../utils/aes-gcm.js";
import { createPrompt } from "./shared.js";

/** Companion files the XMTP SDK creates alongside the main database. */
function xmtpCompanionPaths(dbPath: string) {
  return {
    salt: dbPath + ".sqlcipher_salt",
    wal: dbPath + "-wal",
    shm: dbPath + "-shm",
  };
}

export function registerBackupCommands(program: Command): void {
  // ─── backup ───────────────────────────────────────────────────────────────

  program
    .command("backup")
    .description("Create an encrypted backup of XMTP and Maverick databases")
    .argument("[path]", "Output file path", "maverick-backup.enc")
    .action(async (outputPath: string) => {
      const config = loadConfig();

      // Check that databases exist
      if (!existsSync(config.xmtp.dbPath)) {
        console.error("No XMTP database found. Nothing to back up.");
        console.error(`Expected at: ${config.xmtp.dbPath}`);
        process.exit(1);
      }

      const prompt = createPrompt();

      console.log("Create an encrypted backup of your Maverick data.");
      console.log("You'll need the passphrase to restore this backup.\n");

      const passphrase = await prompt.ask("Backup passphrase: ");
      if (passphrase.length < 8) {
        console.error("Passphrase must be at least 8 characters.");
        prompt.close();
        process.exit(1);
      }
      const confirm = await prompt.ask("Confirm passphrase: ");
      if (passphrase !== confirm) {
        console.error("Passphrases do not match.");
        prompt.close();
        process.exit(1);
      }
      prompt.close();

      // Read database files + companion salt file
      const xmtpDb = readFileSync(config.xmtp.dbPath);
      const companions = xmtpCompanionPaths(config.xmtp.dbPath);
      const saltFile = existsSync(companions.salt)
        ? readFileSync(companions.salt)
        : Buffer.alloc(0);
      const maverickDb = existsSync(config.sqlitePath)
        ? readFileSync(config.sqlitePath)
        : Buffer.alloc(0);

      // Read the XMTP private key so the backup is self-contained.
      let privateKeyBuf = Buffer.alloc(0);
      let privateKeyIncluded = false;
      if (config.bluesky.handle) {
        const cachedKey = await getCachedPrivateKey(config.bluesky.handle);
        if (cachedKey) {
          privateKeyBuf = Buffer.from(cachedKey, "utf-8");
          privateKeyIncluded = true;
        } else {
          console.warn(
            "Warning: No XMTP private key found for this handle. The backup will NOT include the key.",
          );
          console.warn(
            "You will need your recovery phrase to use this backup.\n",
          );
        }
      } else {
        console.warn(
          "Warning: No Bluesky handle configured. Cannot include XMTP private key in backup.",
        );
        console.warn(
          "You will need your recovery phrase to use this backup.\n",
        );
      }

      // v4 Payload: [4B xmtpDbSize] [xmtpDb] [4B saltFileSize] [saltFile] [4B maverickDbSize] [maverickDb] [4B keySize] [privateKey]
      const xmtpSizeBuf = Buffer.alloc(4);
      xmtpSizeBuf.writeUInt32LE(xmtpDb.length, 0);
      const saltSizeBuf = Buffer.alloc(4);
      saltSizeBuf.writeUInt32LE(saltFile.length, 0);
      const mavSizeBuf = Buffer.alloc(4);
      mavSizeBuf.writeUInt32LE(maverickDb.length, 0);
      const keySizeBuf = Buffer.alloc(4);
      keySizeBuf.writeUInt32LE(privateKeyBuf.length, 0);
      const plaintext = Buffer.concat([
        xmtpSizeBuf, xmtpDb,
        saltSizeBuf, saltFile,
        mavSizeBuf, maverickDb,
        keySizeBuf, privateKeyBuf,
      ]);

      const { salt, iv, encrypted, authTag } = encrypt(plaintext, passphrase);

      // File format: [header JSON + newline] [salt 32B] [iv 12B] [authTag 16B] [encrypted]
      const header = JSON.stringify({
        version: 4,
        createdAt: new Date().toISOString(),
        xmtpDbSize: xmtpDb.length,
        saltFileSize: saltFile.length,
        maverickDbSize: maverickDb.length,
        privateKeyIncluded,
      });
      const headerBuf = Buffer.from(header + "\n", "utf-8");
      const headerLenBuf = Buffer.alloc(4);
      headerLenBuf.writeUInt32LE(headerBuf.length, 0);

      const output = Buffer.concat([headerLenBuf, headerBuf, salt, iv, authTag, encrypted]);
      const resolvedPath = resolve(outputPath);
      writeFileSync(resolvedPath, output);

      const sizeMB = (output.length / (1024 * 1024)).toFixed(1);
      console.log(`\nBackup created: ${resolvedPath} (${sizeMB} MB)`);
      if (saltFile.length > 0) {
        console.log("Includes SQLCipher salt file.");
      }
      if (privateKeyIncluded) {
        console.log("Includes XMTP private key — no recovery phrase needed to restore.");
      }
      console.log("Keep this file and your passphrase safe.");
    });

  // ─── restore ──────────────────────────────────────────────────────────────

  program
    .command("restore")
    .description("Restore Maverick databases from an encrypted backup")
    .argument("<path>", "Path to backup file")
    .action(async (inputPath: string) => {
      const config = loadConfig();
      mkdirSync(config.dataDir, { recursive: true });

      const resolvedPath = resolve(inputPath);
      if (!existsSync(resolvedPath)) {
        console.error(`Backup file not found: ${resolvedPath}`);
        process.exit(1);
      }

      // Warn if databases already exist
      if (existsSync(config.xmtp.dbPath) || existsSync(config.sqlitePath)) {
        const confirmPrompt = createPrompt();
        const answer = await confirmPrompt.ask(
          "Existing databases found. Restoring will overwrite them. Continue? [y/N] ",
        );
        confirmPrompt.close();
        if (answer.toLowerCase() !== "y") {
          console.log("Restore cancelled.");
          return;
        }
      }

      const prompt = createPrompt();
      const passphrase = await prompt.ask("Backup passphrase: ");
      prompt.close();

      const data = readFileSync(resolvedPath);
      let offset = 0;

      // Read header
      const headerLen = data.readUInt32LE(offset);
      offset += 4;
      const headerStr = data.subarray(offset, offset + headerLen).toString("utf-8").trim();
      offset += headerLen;
      const header = JSON.parse(headerStr);

      if (![1, 2, 3, 4].includes(header.version)) {
        console.error(`Unsupported backup version: ${header.version}`);
        process.exit(1);
      }

      // Read crypto params — v1 used 16-byte IV, v2+ uses 12 bytes
      const ivSize = header.version === 1 ? IV_SIZE_V1 : IV_SIZE_V2;
      const salt = data.subarray(offset, offset + 32);
      offset += 32;
      const iv = data.subarray(offset, offset + ivSize);
      offset += ivSize;
      const authTag = data.subarray(offset, offset + 16);
      offset += 16;
      const encrypted = data.subarray(offset);

      // Decrypt
      let plaintext: Buffer;
      try {
        plaintext = decrypt(encrypted, passphrase, salt, iv, authTag);
      } catch {
        console.error("Decryption failed. Wrong passphrase or corrupted backup.");
        process.exit(1);
      }

      // Parse payload — format depends on version
      let xmtpDb: Buffer;
      let restoredSaltFile: Buffer = Buffer.alloc(0);
      let maverickDb: Buffer;
      let restoredPrivateKey: string | null = null;

      if (header.version >= 4) {
        // v4: [4B xmtpDbSize] [xmtpDb] [4B saltFileSize] [saltFile] [4B maverickDbSize] [maverickDb] [4B keySize] [privateKey]
        let pOff = 0;
        const xmtpDbSize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        xmtpDb = plaintext.subarray(pOff, pOff + xmtpDbSize);
        pOff += xmtpDbSize;
        const saltFileSize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        restoredSaltFile = plaintext.subarray(pOff, pOff + saltFileSize);
        pOff += saltFileSize;
        const maverickDbSize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        maverickDb = plaintext.subarray(pOff, pOff + maverickDbSize);
        pOff += maverickDbSize;
        const keySize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        if (keySize > 0) {
          restoredPrivateKey = plaintext.subarray(pOff, pOff + keySize).toString("utf-8");
        }
      } else if (header.version === 3) {
        // v3: [4B xmtpDbSize] [xmtpDb] [4B maverickDbSize] [maverickDb] [privateKey UTF-8]
        let pOff = 0;
        const xmtpDbSize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        xmtpDb = plaintext.subarray(pOff, pOff + xmtpDbSize);
        pOff += xmtpDbSize;
        const maverickDbSize = plaintext.readUInt32LE(pOff);
        pOff += 4;
        maverickDb = plaintext.subarray(pOff, pOff + maverickDbSize);
        pOff += maverickDbSize;
        const keyBytes = plaintext.subarray(pOff);
        if (keyBytes.length > 0) {
          restoredPrivateKey = keyBytes.toString("utf-8");
        }
      } else {
        // v1/v2: [4B xmtpDbSize] [xmtpDb] [maverickDb (remainder)]
        const xmtpDbSize = plaintext.readUInt32LE(0);
        xmtpDb = plaintext.subarray(4, 4 + xmtpDbSize);
        maverickDb = plaintext.subarray(4 + xmtpDbSize);
      }

      // Clean up stale SQLite companion files before writing restored databases.
      // WAL/SHM files from a previous session (possibly encrypted with a different
      // key) will cause "PRAGMA key or salt has incorrect value" errors.
      const companions = xmtpCompanionPaths(config.xmtp.dbPath);
      for (const staleFile of [companions.wal, companions.shm, companions.salt]) {
        if (existsSync(staleFile)) {
          unlinkSync(staleFile);
        }
      }

      // Write databases
      writeFileSync(config.xmtp.dbPath, xmtpDb);
      chmodSync(config.xmtp.dbPath, 0o600);

      // Write salt file if present in backup
      if (restoredSaltFile.length > 0) {
        writeFileSync(companions.salt, restoredSaltFile);
        chmodSync(companions.salt, 0o600);
      }

      if (maverickDb.length > 0) {
        writeFileSync(config.sqlitePath, maverickDb);
        chmodSync(config.sqlitePath, 0o600);
      }

      // Restore private key if present
      if (restoredPrivateKey && config.bluesky.handle) {
        const { storeKey } = await import("../storage/keys.js");
        await storeKey(config.bluesky.handle, restoredPrivateKey);
        console.log("\n  Private key restored to local storage.");
      } else if (!restoredPrivateKey) {
        console.warn(
          "\nWarning: This backup does not include the XMTP private key (old format).",
        );
        console.warn(
          "You will need to run `maverick recover` with your recovery phrase before using this identity.",
        );
      } else if (!config.bluesky.handle) {
        console.warn(
          "\nWarning: No Bluesky handle configured — could not store the restored private key.",
        );
        console.warn(
          "Run `maverick login` and then restore again, or use `maverick recover`.",
        );
      }

      if (header.version < 4 && restoredSaltFile.length === 0) {
        console.warn(
          "\nWarning: This backup (v" + header.version + ") does not include the SQLCipher salt file.",
        );
        console.warn(
          "If the XMTP database fails to open, create a fresh backup with `maverick backup`.",
        );
      }

      console.log(`\nRestore complete!`);
      console.log(`  XMTP database: ${config.xmtp.dbPath} (${(xmtpDb.length / 1024).toFixed(0)} KB)`);
      if (restoredSaltFile.length > 0) {
        console.log(`  SQLCipher salt: ${companions.salt} (${restoredSaltFile.length} B)`);
      }
      if (maverickDb.length > 0) {
        console.log(`  Maverick database: ${config.sqlitePath} (${(maverickDb.length / 1024).toFixed(0)} KB)`);
      }
      console.log(`  Created: ${header.createdAt}`);
      if (restoredPrivateKey && config.bluesky.handle) {
        console.log("\nYou can now run `maverick login` to resume using your identity.");
      } else {
        console.log("\nRun `maverick recover` with your recovery phrase to restore your XMTP key.");
      }
    });
}
