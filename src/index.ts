import { Command } from "commander";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { createBlueskySession } from "./identity/atproto.js";
import {
  publishMaverickRecord,
  getMaverickRecord,
  getLegacyInboxRecord,
} from "./identity/bridge.js";
import { normalizePhrase, validateRecoveryPhrase } from "./identity/recovery-phrase.js";
import {
  resolveHandleToInbox,
  verifyInboxAssociation,
} from "./identity/resolver.js";
import {
  createXmtpClient,
  getCachedPrivateKey,
  createNewIdentity,
  commitIdentity,
  recoverIdentity,
  migrateLegacyIdentity,
} from "./identity/xmtp.js";
import { createDatabase } from "./storage/db.js";
import { CommunityManager } from "./community/manager.js";
import {
  createInvite,
  verifyInvite,
  encodeInvite,
  decodeInvite,
} from "./community/invites.js";
import { sendMessage } from "./messaging/sender.js";
import { MaverickMessageContentType } from "./messaging/codec.js";
import { insertMessage, insertParents } from "./storage/messages.js";
import { saveSession, clearSession } from "./storage/session.js";
import { sanitize } from "./utils/sanitize.js";
import type { Client } from "@xmtp/node-sdk";
import type { AtpAgent } from "@atproto/api";
import type { Config } from "./config.js";
import type { BlueskySession } from "./identity/atproto.js";

const program = new Command();

program
  .name("maverick")
  .description("Private community chat on ATProto + XMTP")
  .version("0.1.0");

// ─── Non-interactive bootstrap ───────────────────────────────────────────
// Used by all commands except `login` and `recover`.
// Fails with guidance if no cached key exists.

async function bootstrap(): Promise<{
  config: Config;
  bsky: BlueskySession;
  xmtp: Client;
  privateKey: `0x${string}`;
}> {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });

  let bsky: BlueskySession;
  try {
    bsky = await createBlueskySession(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Missing Bluesky credentials/i.test(msg)) {
      throw new Error(
        "Missing Bluesky credentials. Run 'maverick login' first, or set MAVERICK_BLUESKY_HANDLE and MAVERICK_BLUESKY_PASSWORD environment variables.",
      );
    }
    throw err;
  }

  // Try cache first
  let privateKey = await getCachedPrivateKey(bsky.handle);

  // Try legacy migration (old passphrase-encrypted key file)
  if (!privateKey) {
    privateKey = await migrateLegacyIdentity(bsky.handle, config.bluesky.password);
    if (privateKey) {
      console.log("Migrated legacy key to new storage format.");
    }
  }

  // No key found — fail with guidance
  if (!privateKey) {
    throw new Error(
      "No identity found. Run `maverick login` to set up or recover your identity.",
    );
  }

  const xmtp = await createXmtpClient(config, privateKey);

  return { config, bsky, xmtp, privateKey };
}

// ─── Shared utilities ────────────────────────────────────────────────────

function createPrompt(): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q) => new Promise<string>((resolve) => rl.question(q, resolve)),
    close: () => rl.close(),
  };
}

async function recoverAndFinish(
  config: Config,
  bsky: { agent: AtpAgent; did: string; handle: string },
  xmtp: Client,
  privateKey?: `0x${string}`,
): Promise<void> {
  // Persist the verified key now that createXmtpClient() succeeded.
  // This must happen AFTER verification to avoid poisoning the key cache
  // with an incorrect key derived from a wrong recovery phrase.
  if (privateKey) {
    const { storeKey } = await import("./storage/keys.js");
    await storeKey(bsky.handle, privateKey);
  }

  const db = createDatabase(config.sqlitePath);
  const manager = new CommunityManager(xmtp, db);
  const result = await manager.recoverAllCommunities({
    onProgress: (msg) => console.log(`  ${msg}`),
  });
  console.log(
    `Recovered ${result.communities.length} community(ies), ${result.channelsRecovered} channels.`,
  );
  db.close();

  await publishMaverickRecord(bsky.agent, xmtp);
  saveSession(bsky.handle, config.bluesky.password);
}

// ─── login ────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Authenticate with Bluesky + set up or recover XMTP identity")
  .action(async () => {
    let config = loadConfig();
    mkdirSync(config.dataDir, { recursive: true });

    // Prompt for credentials interactively if not available
    if (!config.bluesky.handle || !config.bluesky.password) {
      const credPrompt = createPrompt();
      console.log("No Bluesky credentials found. Please enter them below.\n");
      const handle = config.bluesky.handle || await credPrompt.ask("Bluesky handle: ");
      const password = config.bluesky.password || await credPrompt.ask("App password: ");
      credPrompt.close();

      config = {
        ...config,
        bluesky: { ...config.bluesky, handle, password },
      };
    }

    const bsky = await createBlueskySession(config);

    console.log(`Authenticated as ${bsky.handle} (${bsky.did})`);

    // 1. Try cached key
    let privateKey = await getCachedPrivateKey(bsky.handle);
    if (privateKey) {
      const xmtp = await createXmtpClient(config, privateKey);
      console.log(`Already logged in. Inbox ID: ${xmtp.inboxId}`);
      await publishMaverickRecord(bsky.agent, xmtp);
      saveSession(bsky.handle, config.bluesky.password);
      console.log("Login complete!");
      return;
    }

    // 2. Try legacy migration
    privateKey = await migrateLegacyIdentity(bsky.handle, config.bluesky.password);
    if (privateKey) {
      const xmtp = await createXmtpClient(config, privateKey);
      console.log(`Migrated legacy key. Inbox ID: ${xmtp.inboxId}`);
      await publishMaverickRecord(bsky.agent, xmtp);
      saveSession(bsky.handle, config.bluesky.password);
      console.log("Login complete!");
      return;
    }

    // 3. Check PDS for community.maverick.inbox (returning user detection)
    const existingRecord = await getMaverickRecord(bsky.agent, bsky.did);

    const prompt = createPrompt();

    if (existingRecord) {
      // Returning user — prompt for recovery phrase
      console.log("\nExisting Maverick identity found on your PDS.");
      console.log(`Inbox ID: ${existingRecord.inboxId}`);
      console.log("Enter your recovery phrase to restore access.\n");

      const phrase = await prompt.ask("Recovery phrase: ");
      privateKey = await recoverIdentity(bsky.handle, bsky.did, phrase);
      const xmtp = await createXmtpClient(config, privateKey);

      // Verify inbox ID matches
      if (xmtp.inboxId !== existingRecord.inboxId) {
        console.error(
          `\nInbox ID mismatch! Expected: ${existingRecord.inboxId}, got: ${xmtp.inboxId}`,
        );
        console.error(
          "Wrong recovery phrase. Try again or use `maverick login` with the correct phrase.",
        );
        prompt.close();
        process.exit(1);
      }

      console.log(`Recovered! Inbox ID: ${xmtp.inboxId}`);

      await recoverAndFinish(config, bsky, xmtp, privateKey);
      prompt.close();
      console.log("Login complete!");
      return;
    }

    // 4. New user — generate phrase
    console.log("\nNo existing Maverick identity found. Creating new identity.\n");

    const { recoveryPhrase, privateKey: newKey } = await createNewIdentity(
      bsky.handle,
      bsky.did,
    );
    privateKey = newKey;
    // NOTE: key is NOT cached yet — we wait until the user confirms the phrase.

    console.log("========================================");
    console.log("  YOUR RECOVERY PHRASE");
    console.log("  Write this down and keep it safe:");
    console.log(`\n  ${recoveryPhrase}\n`);
    console.log("  You need this phrase to recover your");
    console.log("  identity on a new device.");
    console.log("========================================\n");

    // Confirm phrase
    const confirmed = await prompt.ask("Type your recovery phrase to confirm: ");
    if (normalizePhrase(confirmed) !== normalizePhrase(recoveryPhrase)) {
      console.error("\nPhrase does not match! Please try again.");
      console.error(`Expected ${recoveryPhrase.split(" ").length} words.`);
      // Let them retry
      const retry = await prompt.ask("Type your recovery phrase to confirm: ");
      if (normalizePhrase(retry) !== normalizePhrase(recoveryPhrase)) {
        console.error(
          "\nPhrase still does not match. Your identity has been created.",
        );
        console.error("Run `maverick export-key` to back up your private key.");
      } else {
        console.log("Phrase confirmed!");
      }
    } else {
      console.log("Phrase confirmed!");
    }

    // Key is committed to storage only after the user has seen (and had the
    // opportunity to confirm) the recovery phrase.
    await commitIdentity(bsky.handle, privateKey);

    const xmtp = await createXmtpClient(config, privateKey);
    console.log(`XMTP Inbox ID: ${xmtp.inboxId}`);

    await publishMaverickRecord(bsky.agent, xmtp);
    saveSession(bsky.handle, config.bluesky.password);
    prompt.close();
    console.log("\nLogin complete!");
  });

// ─── recover ──────────────────────────────────────────────────────────────

program
  .command("recover")
  .description("Recover identity from a recovery phrase")
  .action(async () => {
    let config = loadConfig();
    mkdirSync(config.dataDir, { recursive: true });

    // Prompt for credentials interactively if not available
    if (!config.bluesky.handle || !config.bluesky.password) {
      const credPrompt = createPrompt();
      console.log("No Bluesky credentials found. Please enter them below.\n");
      const handle = config.bluesky.handle || await credPrompt.ask("Bluesky handle: ");
      const password = config.bluesky.password || await credPrompt.ask("App password: ");
      credPrompt.close();

      config = {
        ...config,
        bluesky: { ...config.bluesky, handle, password },
      };
    }

    const bsky = await createBlueskySession(config);

    console.log(`Authenticated as ${bsky.handle} (${bsky.did})`);

    const prompt = createPrompt();

    const phrase = await prompt.ask("Recovery phrase: ");
    if (!validateRecoveryPhrase(phrase)) {
      console.error("Invalid recovery phrase. Must be 6 words from the EFF Diceware wordlist.");
      prompt.close();
      return;
    }

    const privateKey = await recoverIdentity(bsky.handle, bsky.did, phrase);
    const xmtp = await createXmtpClient(config, privateKey);

    console.log(`Inbox ID: ${xmtp.inboxId}`);
    console.log(`Installation ID: ${xmtp.installationId}`);

    // Show installation count
    try {
      const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
      if (inboxStates?.[0]) {
        const instCount = inboxStates[0].installations?.length ?? 0;
        console.log(`Installations: ${instCount}/10`);
        if (instCount >= 8) {
          console.warn(
            "WARNING: Approaching installation limit (10). Consider revoking stale installations.",
          );
        }
      }
    } catch {
      // Non-fatal — installation count is informational
    }

    console.log("\nRecovering communities...");
    await recoverAndFinish(config, bsky, xmtp, privateKey);
    prompt.close();
    console.log("\nRecovery complete!");
  });

// ─── logout ──────────────────────────────────────────────────────────────

program
  .command("logout")
  .description("Clear saved Bluesky credentials from the OS keychain")
  .action(() => {
    try {
      clearSession();
      console.log("Session cleared from OS keychain.");
    } catch (err) {
      console.error(
        "Failed to clear session:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

// ─── status ──────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show identity and installation status")
  .action(async () => {
    const { config, bsky, xmtp } = await bootstrap();

    console.log(`Handle:          ${bsky.handle}`);
    console.log(`DID:             ${bsky.did}`);
    console.log(`XMTP Inbox ID:   ${xmtp.inboxId}`);
    console.log(`Installation ID: ${xmtp.installationId}`);

    // Check installations
    try {
      const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
      if (inboxStates?.[0]) {
        const installations = inboxStates[0].installations ?? [];
        console.log(`\nInstallations:   ${installations.length}/10`);
        if (installations.length >= 8) {
          console.warn(
            "WARNING: Approaching installation limit. Run `maverick revoke-stale` to clean up.",
          );
        }
      }
    } catch {
      console.log("\nInstallations:   (unable to fetch)");
    }

    // Check PDS record
    const record = await getMaverickRecord(bsky.agent, bsky.did);
    console.log(`\nPDS Record:      ${record ? "published" : "NOT published"}`);
    if (record) {
      console.log(`  Inbox ID:      ${record.inboxId}`);
      console.log(`  Created:       ${record.createdAt}`);
    }

    // Check local data
    console.log(`\nLocal Data:      ${config.dataDir}`);
    console.log(`  SQLite DB:     ${existsSync(config.sqlitePath) ? "exists" : "missing"}`);
    console.log(`  XMTP DB:       ${existsSync(config.xmtp.dbPath) ? "exists" : "missing"}`);

    if (!existsSync(config.sqlitePath) || !existsSync(config.xmtp.dbPath)) {
      console.log(
        "\nSome local data is missing. Run `maverick recover` to rebuild from the network.",
      );
    }
  });

// ─── whoami ───────────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show current identity info")
  .action(async () => {
    const { bsky, xmtp } = await bootstrap();

    console.log(`Handle:          ${bsky.handle}`);
    console.log(`DID:             ${bsky.did}`);
    console.log(`XMTP Inbox ID:   ${xmtp.inboxId}`);
    console.log(`Installation ID: ${xmtp.installationId}`);
  });

// ─── installations ───────────────────────────────────────────────────────

program
  .command("installations")
  .description("List XMTP installations for your inbox")
  .action(async () => {
    const { xmtp } = await bootstrap();

    const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
    if (!inboxStates?.[0]?.installations?.length) {
      console.log("No installations found.");
      return;
    }

    const installations = inboxStates[0].installations;
    console.log(`Installations (${installations.length}/10):\n`);

    const currentHex = Buffer.from(xmtp.installationIdBytes).toString("hex");

    for (const inst of installations) {
      const instHex = Buffer.from(inst.bytes).toString("hex");
      const isCurrent = instHex === currentHex;
      const marker = isCurrent ? " (current)" : "";
      const shortId = instHex.slice(0, 16);
      console.log(`  ${shortId}...${marker}`);
    }

    if (installations.length >= 8) {
      console.warn(
        "\nWARNING: Approaching 10-installation limit. Consider running `maverick revoke-stale`.",
      );
    }
  });

// ─── revoke-stale ────────────────────────────────────────────────────────

program
  .command("revoke-stale")
  .description("Revoke stale XMTP installations")
  .option("--all", "Revoke ALL other installations (not just stale ones)")
  .action(async (opts: { all?: boolean }) => {
    const { xmtp } = await bootstrap();

    const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
    if (!inboxStates?.[0]?.installations?.length) {
      console.log("No installations found.");
      return;
    }

    const installations = inboxStates[0].installations;
    const currentHex = Buffer.from(xmtp.installationIdBytes).toString("hex");

    // Find installations to revoke
    const toRevoke: Uint8Array[] = [];
    for (const inst of installations) {
      const instHex = Buffer.from(inst.bytes).toString("hex");
      if (instHex === currentHex) continue; // Never revoke current

      if (opts.all) {
        toRevoke.push(inst.bytes);
      }
      // For non-all mode, we'd check key package health here
      // but fetchKeyPackageStatuses may not be available in all SDK versions.
      // For now, --all is the only supported mode; without it we skip.
    }

    if (toRevoke.length === 0) {
      if (!opts.all && installations.length > 1) {
        console.log(
          "Automatic stale installation detection is not yet available.\n" +
          "Use `maverick revoke-stale --all` to revoke all other installations.",
        );
      } else {
        console.log("No installations to revoke.");
      }
      return;
    }

    console.log(`Revoking ${toRevoke.length} installation(s)...`);
    await xmtp.revokeInstallations(toRevoke);
    console.log("Done.");
  });

// ─── export-key ──────────────────────────────────────────────────────────

program
  .command("export-key")
  .description("Display your XMTP private key (SECURITY WARNING)")
  .action(async () => {
    const { privateKey, bsky } = await bootstrap();

    console.log("\n========================================");
    console.log("  SECURITY WARNING");
    console.log("  Your private key controls your XMTP");
    console.log("  identity. Never share it with anyone.");
    console.log("========================================\n");
    console.log(`Handle: ${bsky.handle}`);
    console.log(`Key:    ${privateKey}`);
    console.log("\nUse `maverick import-key <key>` to restore on another device.");
  });

// ─── import-key ──────────────────────────────────────────────────────────

program
  .command("import-key")
  .description("Import an XMTP private key directly")
  .argument("<key>", "Hex private key (0x...)")
  .action(async (key: string) => {
    if (!key.startsWith("0x") || key.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.error("Invalid key format. Expected 0x followed by 64 hex characters.");
      return;
    }

    // Verify it's a valid secp256k1 private key
    try {
      privateKeyToAccount(key as `0x${string}`);
    } catch {
      console.error("Invalid private key. The value is not a valid secp256k1 key.");
      return;
    }

    const config = loadConfig();
    mkdirSync(config.dataDir, { recursive: true });
    const bsky = await createBlueskySession(config);

    await commitIdentity(bsky.handle, key as `0x${string}`);
    const xmtp = await createXmtpClient(config, key as `0x${string}`);

    console.log(`Imported key for ${bsky.handle}`);
    console.log(`Inbox ID: ${xmtp.inboxId}`);

    await publishMaverickRecord(bsky.agent, xmtp);
    saveSession(bsky.handle, config.bluesky.password);
    console.log("Import complete!");
  });

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

    // Read database files
    const xmtpDb = readFileSync(config.xmtp.dbPath);
    const maverickDb = existsSync(config.sqlitePath)
      ? readFileSync(config.sqlitePath)
      : Buffer.alloc(0);

    // Read the XMTP private key so the backup is self-contained.
    // Without the key the restored XMTP database is unreadable (encrypted with
    // a different key than whatever the user generates on next login).
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

    // Encrypt: scrypt key derivation + AES-256-GCM
    // 12-byte (96-bit) IV per NIST SP 800-38D recommendation for GCM.
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const key = scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    // v3 Payload: [4B xmtpDbSize LE] [xmtpDb] [4B maverickDbSize LE] [maverickDb] [privateKey UTF-8]
    // The private key occupies the remaining bytes after the two sized segments.
    const xmtpSizeBuf = Buffer.alloc(4);
    xmtpSizeBuf.writeUInt32LE(xmtpDb.length, 0);
    const mavSizeBuf = Buffer.alloc(4);
    mavSizeBuf.writeUInt32LE(maverickDb.length, 0);
    const plaintext = Buffer.concat([xmtpSizeBuf, xmtpDb, mavSizeBuf, maverickDb, privateKeyBuf]);

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // File format: [header JSON + newline] [salt 32B] [iv 12B] [authTag 16B] [encrypted]
    // Version 3 adds the XMTP private key to the encrypted payload.
    const header = JSON.stringify({
      version: 3,
      createdAt: new Date().toISOString(),
      xmtpDbSize: xmtpDb.length,
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

    if (header.version !== 1 && header.version !== 2 && header.version !== 3) {
      console.error(`Unsupported backup version: ${header.version}`);
      process.exit(1);
    }

    // Read crypto params
    // v1 used a 16-byte IV; v2+ uses 12 bytes (NIST SP 800-38D recommended).
    const ivSize = header.version === 1 ? 16 : 12;
    const salt = data.subarray(offset, offset + 32);
    offset += 32;
    const iv = data.subarray(offset, offset + ivSize);
    offset += ivSize;
    const authTag = data.subarray(offset, offset + 16);
    offset += 16;
    const encrypted = data.subarray(offset);

    // Decrypt
    const key = scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch {
      console.error("Decryption failed. Wrong passphrase or corrupted backup.");
      process.exit(1);
    }

    // Parse payload — format depends on version
    let xmtpDb: Buffer;
    let maverickDb: Buffer;
    let restoredPrivateKey: string | null = null;

    if (header.version >= 3) {
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

    // Write databases
    writeFileSync(config.xmtp.dbPath, xmtpDb);
    chmodSync(config.xmtp.dbPath, 0o600);

    if (maverickDb.length > 0) {
      writeFileSync(config.sqlitePath, maverickDb);
      chmodSync(config.sqlitePath, 0o600);
    }

    // Restore private key if present
    if (restoredPrivateKey && config.bluesky.handle) {
      const { storeKey } = await import("./storage/keys.js");
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

    console.log(`\nRestore complete!`);
    console.log(`  XMTP database: ${config.xmtp.dbPath} (${(xmtpDb.length / 1024).toFixed(0)} KB)`);
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

// ─── resolve ──────────────────────────────────────────────────────────────

program
  .command("resolve")
  .description("Resolve a Bluesky handle to XMTP Inbox ID")
  .argument("<handle>", "Bluesky handle to resolve")
  .action(async (handle: string) => {
    const { config, bsky } = await bootstrap();

    console.log(`Resolving ${handle}...`);
    let result: { inboxId: string; did: string };
    try {
      result = await resolveHandleToInbox(bsky.agent, handle);
    } catch (err) {
      console.log(err instanceof Error ? err.message : String(err));
      return;
    }

    console.log(`DID:      ${result.did}`);
    console.log(`Inbox ID: ${result.inboxId}`);

    const record = await getLegacyInboxRecord(bsky.agent, result.did);
    if (record) {
      const valid = await verifyInboxAssociation(
        result.inboxId,
        result.did,
        record.verificationSignature,
        config.xmtp.env,
      );
      console.log(`Verified: ${valid}`);
    }
  });

// ─── create ───────────────────────────────────────────────────────────────

program
  .command("create")
  .description("Create a new community")
  .argument("<name>", "Community name")
  .option("-d, --description <desc>", "Community description")
  .action(async (name: string, opts: { description?: string }) => {
    const { config, xmtp } = await bootstrap();
    const db = createDatabase(config.sqlitePath);
    const manager = new CommunityManager(xmtp, db);

    console.log(`Creating community "${name}"...`);
    const metaGroupId = await manager.createCommunity(name, opts.description);
    console.log(`Community created! Meta group ID: ${metaGroupId}`);

    // Create a default #general channel
    console.log("Creating #general channel...");
    const channelId = await manager.createChannel(
      metaGroupId,
      "general",
      "open",
      "General discussion",
    );
    console.log(`Channel created! ID: ${channelId}`);

    db.close();
  });

// ─── channels ─────────────────────────────────────────────────────────────

program
  .command("channels")
  .description("List channels in a community")
  .argument("<meta-group-id>", "Meta channel group ID")
  .action(async (metaGroupId: string) => {
    const { config, xmtp } = await bootstrap();
    const db = createDatabase(config.sqlitePath);
    const manager = new CommunityManager(xmtp, db);

    console.log("Syncing community state...");
    const state = await manager.syncCommunityState(metaGroupId);

    if (state.config) {
      console.log(`\nCommunity: ${state.config.name}`);
      if (state.config.description) {
        console.log(`  ${state.config.description}`);
      }
    }

    console.log("\nChannels:");
    for (const [, ch] of state.channels) {
      const status = ch.archived ? " [archived]" : "";
      console.log(`  #${ch.name}${status} (${ch.permissions}) - ${ch.xmtpGroupId}`);
    }

    db.close();
  });

// ─── add-channel ──────────────────────────────────────────────────────────

program
  .command("add-channel")
  .description("Add a channel to a community")
  .argument("<meta-group-id>", "Meta channel group ID")
  .argument("<name>", "Channel name")
  .option("-d, --description <desc>", "Channel description")
  .option(
    "-p, --permissions <perms>",
    "Permissions: open, moderated, read-only",
    "open",
  )
  .action(
    async (
      metaGroupId: string,
      name: string,
      opts: { description?: string; permissions: string },
    ) => {
      const { config, xmtp } = await bootstrap();
      const db = createDatabase(config.sqlitePath);
      const manager = new CommunityManager(xmtp, db);

      const validPerms = ["open", "moderated", "read-only"] as const;
      if (!validPerms.includes(opts.permissions as typeof validPerms[number])) {
        console.error(
          `Invalid permissions: "${opts.permissions}". Must be one of: ${validPerms.join(", ")}`,
        );
        db.close();
        return;
      }

      console.log(`Creating #${name}...`);
      const channelId = await manager.createChannel(
        metaGroupId,
        name,
        opts.permissions as "open" | "moderated" | "read-only",
        opts.description,
      );
      console.log(`Channel created! ID: ${channelId}`);

      db.close();
    },
  );

// ─── invite ───────────────────────────────────────────────────────────────

program
  .command("invite")
  .description("Generate an invite token for a community")
  .argument("<meta-group-id>", "Meta channel group ID")
  .option("-r, --role <role>", "Role: member or moderator", "member")
  .option(
    "-e, --expiry <hours>",
    "Expiry in hours",
    "72",
  )
  .action(
    async (
      metaGroupId: string,
      opts: { role: string; expiry: string },
    ) => {
      const validRoles = ["member", "moderator"] as const;
      if (!validRoles.includes(opts.role as typeof validRoles[number])) {
        console.error(
          `Invalid role: "${opts.role}". Must be one of: ${validRoles.join(", ")}`,
        );
        return;
      }

      const { config, bsky, xmtp, privateKey } = await bootstrap();
      const db = createDatabase(config.sqlitePath);

      const manager = new CommunityManager(xmtp, db);
      const state = await manager.syncCommunityState(metaGroupId);
      const communityName = state.config?.name ?? "Unknown";

      const expiryHours = parseInt(opts.expiry, 10);
      if (!Number.isFinite(expiryHours) || expiryHours < 1) {
        console.error(
          `Invalid expiry: "${opts.expiry}". Must be a positive integer (hours).`,
        );
        db.close();
        return;
      }

      const invite = await createInvite(
        privateKey,
        communityName,
        metaGroupId,
        bsky.did,
        opts.role as "member" | "moderator",
        expiryHours,
      );

      const encoded = encodeInvite(invite);
      console.log("\nInvite token generated!");
      console.log(`Community: ${communityName}`);
      console.log(`Role: ${invite.role}`);
      console.log(`Expires: ${invite.expiry}`);
      console.log(`\nShare this token:\n${encoded}`);

      db.close();
    },
  );

// ─── join ─────────────────────────────────────────────────────────────────

program
  .command("join")
  .description("Join a community via invite token")
  .argument("<token>", "Invite token string")
  .action(async (token: string) => {
    const { xmtp } = await bootstrap();

    const invite = decodeInvite(token);
    console.log(`Joining community: ${invite.communityName}`);
    console.log(`Role: ${invite.role}`);
    console.log(`Invited by: ${invite.inviterDid}`);

    // Verify the invite using the inviter's public Ethereum address
    const valid = await verifyInvite(invite);
    if (!valid) {
      console.error(
        "\nInvite verification FAILED. The invite may be expired, tampered with, or forged.",
      );
      process.exit(1);
    }
    console.log("Invite signature verified.");

    // Request the inviter to add us to the community groups
    console.log(`\nYour XMTP Inbox ID: ${xmtp.inboxId}`);
    console.log(
      "\nAsk the inviter to run:",
    );
    console.log(
      `  maverick add-member ${invite.metaChannelGroupId} ${xmtp.inboxId}`,
    );
  });

// ─── add-member ───────────────────────────────────────────────────────────

program
  .command("add-member")
  .description("Add a member to a community by their XMTP inbox ID")
  .argument("<meta-group-id>", "Meta channel group ID")
  .argument("<inbox-id>", "Member's XMTP inbox ID")
  .action(async (metaGroupId: string, inboxId: string) => {
    const { config, xmtp } = await bootstrap();
    const db = createDatabase(config.sqlitePath);
    const manager = new CommunityManager(xmtp, db);

    console.log(`Adding member ${inboxId} to community...`);
    await manager.addMember(metaGroupId, inboxId);
    console.log("Member added to meta channel and all channels.");

    db.close();
  });

// ─── communities ──────────────────────────────────────────────────────────

program
  .command("communities")
  .description("List communities you belong to")
  .action(async () => {
    const { xmtp } = await bootstrap();
    const db = createDatabase(loadConfig().sqlitePath);
    const manager = new CommunityManager(xmtp, db);

    console.log("Scanning for communities...");
    const communities = await manager.listCommunities();

    if (communities.length === 0) {
      console.log("No communities found.");
    } else {
      console.log(`\nFound ${communities.length} community(ies):\n`);
      for (const c of communities) {
        console.log(`  ${c.name}`);
        console.log(`    Meta group: ${c.groupId}`);
      }
    }

    db.close();
  });

// ─── chat ─────────────────────────────────────────────────────────────────

program
  .command("chat")
  .description("Enter interactive chat mode in a channel")
  .argument("<meta-group-id>", "Meta channel group ID")
  .argument("<channel-name>", "Channel name to chat in")
  .action(async (metaGroupId: string, channelName: string) => {
    const { config, xmtp } = await bootstrap();
    const db = createDatabase(config.sqlitePath);
    const manager = new CommunityManager(xmtp, db);

    // Sync state
    console.log("Syncing community state...");
    const state = await manager.syncCommunityState(metaGroupId);

    // Find the channel
    let targetChannel: { channelId: string; xmtpGroupId: string; name: string } | null = null;
    for (const [, ch] of state.channels) {
      if (ch.name === channelName) {
        targetChannel = ch;
        break;
      }
    }

    if (!targetChannel) {
      console.error(`Channel #${channelName} not found.`);
      console.log("Available channels:");
      for (const [, ch] of state.channels) {
        console.log(`  #${ch.name}`);
      }
      db.close();
      return;
    }

    // Get the XMTP group for this channel
    const group = await xmtp.conversations.getConversationById(
      targetChannel.xmtpGroupId,
    );
    if (!group) {
      console.error(
        `XMTP group ${targetChannel.xmtpGroupId} not found. You may need to sync.`,
      );
      db.close();
      return;
    }

    await group.sync();

    console.log(`\n═══ #${targetChannel.name} ═══`);
    console.log('Type messages and press Enter to send. Use "> msgId text" to reply.');
    console.log("Press Ctrl+C to exit.\n");

    // Show recent messages and persist them
    const recent = await group.messages({ limit: 20 });
    for (const msg of recent) {
      persistMessage(msg, targetChannel.channelId);
      printMessage(msg);
    }

    // Start streaming
    const stream = await group.stream({
      onValue: (msg) => {
        persistMessage(msg, targetChannel.channelId);
        printMessage(msg);
      },
    });

    // Read from stdin
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `[#${targetChannel.name}] > `,
    });

    rl.prompt();

    rl.on("line", async (line: string) => {
      const text = line.trim();
      if (!text) {
        rl.prompt();
        return;
      }

      // Check for reply syntax: > messageId text
      const replyMatch = text.match(/^>\s+(\S+)\s+(.+)$/);
      try {
        if (replyMatch) {
          const [, parentId, replyText] = replyMatch;
          await sendMessage(group, replyText, [parentId]);
        } else {
          await sendMessage(group, text);
        }
      } catch (err) {
        console.error("Failed to send message:", err instanceof Error ? err.message : err);
      }

      rl.prompt();
    });

    // Guard against double-cleanup (SIGINT fires, then readline emits 'close')
    let cleanedUp = false;
    async function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      console.log("\nExiting chat...");
      try { await stream.return(); } catch { /* stream may already be closed */ }
      try { db.close(); } catch { /* db may already be closed */ }
      process.exit(0);
    }

    rl.on("close", cleanup);
    process.on("SIGINT", cleanup);

    function persistMessage(
      msg: { senderInboxId: string; content: unknown; id: string; sentAt: Date; contentType?: { authorityId: string; typeId: string } },
      channelId: string,
    ) {
      try {
        if (
          msg.contentType?.authorityId === MaverickMessageContentType.authorityId &&
          msg.contentType?.typeId === MaverickMessageContentType.typeId
        ) {
          const content = msg.content as { text?: string; replyTo?: string[]; editOf?: string; deleteOf?: string };
          insertMessage(db, {
            id: msg.id,
            channelId,
            senderInboxId: msg.senderInboxId,
            text: content?.text ?? "",
            editOf: content?.editOf,
            deleteOf: content?.deleteOf,
            createdAt: msg.sentAt.getTime(),
          });
          if (content?.replyTo && content.replyTo.length > 0) {
            insertParents(db, msg.id, content.replyTo);
          }
        }
      } catch {
        // Don't crash the stream on persistence errors
      }
    }

    function printMessage(msg: { senderInboxId: string; content: unknown; id: string; sentAt: Date; contentType?: { authorityId: string; typeId: string } }) {
      const time = msg.sentAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const sender = msg.senderInboxId.slice(0, 8);

      // Try to decode as MaverickMessage
      if (
        msg.contentType?.authorityId === MaverickMessageContentType.authorityId &&
        msg.contentType?.typeId === MaverickMessageContentType.typeId
      ) {
        try {
          const content = msg.content as { text?: string; replyTo?: string[]; editOf?: string; deleteOf?: string };
          if (content?.deleteOf) {
            console.log(`  [${time}] ${sender}: [deleted]`);
            return;
          }
          const replyIndicator =
            content?.replyTo && content.replyTo.length > 0
              ? ` (reply to ${content.replyTo.map((id: string) => id.slice(0, 8)).join(", ")})`
              : "";
          const editIndicator = content?.editOf ? " [edited]" : "";
          console.log(
            `  [${time}] ${sender}${replyIndicator}${editIndicator}: ${sanitize(content?.text ?? "[no text]")}`,
          );
          return;
        } catch {
          // Fall through to default display
        }
      }

      // Default: show raw content as string
      const text =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      console.log(`  [${time}] ${sender}: ${sanitize(text)}`);
    }
  });

// ─── tui ─────────────────────────────────────────────────────────────────

program
  .command("tui", { isDefault: true })
  .description("Launch the full TUI interface (handles login interactively)")
  .argument("[meta-group-id]", "Optional: jump directly to a community")
  .action(async (metaGroupId?: string) => {
    const config = loadConfig();
    mkdirSync(config.dataDir, { recursive: true });

    const { render } = await import("ink");
    const React = await import("react");
    const { App } = await import("./tui/App.js");

    if (metaGroupId) {
      // Legacy mode: pre-authenticate and jump to chat
      const bsky = await createBlueskySession(config);

      // Non-interactive: try cached key, then legacy migration, then fail
      let privateKey = await getCachedPrivateKey(bsky.handle);
      if (!privateKey) {
        privateKey = await migrateLegacyIdentity(bsky.handle, config.bluesky.password);
      }
      if (!privateKey) {
        throw new Error(
          "No identity found. Run `maverick login` to set up or recover your identity.",
        );
      }

      const xmtp = await createXmtpClient(config, privateKey);
      const db = createDatabase(config.sqlitePath);

      render(
        React.createElement(App, {
          xmtpClient: xmtp,
          db,
          metaGroupId,
          handle: bsky.handle,
        }),
      );
    } else {
      // Full-workflow mode: interactive login -> community list -> chat
      render(
        React.createElement(App, {
          initialConfig: config,
        }),
      );
    }
  });

program.parse();
