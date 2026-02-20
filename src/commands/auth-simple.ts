import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getMaverickRecord } from "../identity/bridge.js";
import { clearSession } from "../storage/session.js";
import { bootstrap } from "./shared.js";

export function registerAuthSimpleCommands(program: Command): void {
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
}
