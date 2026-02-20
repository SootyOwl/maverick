import { mkdirSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import { validateRecoveryPhrase } from "../identity/recovery-phrase.js";
import {
  createXmtpClient,
  recoverIdentity,
} from "../identity/xmtp.js";
import { createPrompt, ensureCredentials, recoverAndFinish } from "./shared.js";

export function registerRecoverCommand(program: Command): void {
  program
    .command("recover")
    .description("Recover identity from a recovery phrase")
    .action(async () => {
      let config = loadConfig();
      mkdirSync(config.dataDir, { recursive: true });

      config = await ensureCredentials(config);

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
}
