import { mkdirSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import {
  publishMaverickRecord,
  getMaverickRecord,
} from "../identity/bridge.js";
import { normalizePhrase } from "../identity/recovery-phrase.js";
import {
  createXmtpClient,
  getCachedPrivateKey,
  createNewIdentity,
  commitIdentity,
  recoverIdentity,
  migrateLegacyIdentity,
} from "../identity/xmtp.js";
import { saveSession } from "../storage/session.js";
import { createPrompt, ensureCredentials, recoverAndFinish } from "./shared.js";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with Bluesky + set up or recover XMTP identity")
    .action(async () => {
      let config = loadConfig();
      mkdirSync(config.dataDir, { recursive: true });

      config = await ensureCredentials(config);

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
}
