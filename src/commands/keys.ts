import { mkdirSync } from "node:fs";
import type { Command } from "commander";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import { publishMaverickRecord } from "../identity/bridge.js";
import {
  createXmtpClient,
  commitIdentity,
} from "../identity/xmtp.js";
import { saveSession } from "../storage/session.js";
import { bootstrap } from "./shared.js";

export function registerKeyCommands(program: Command): void {
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
}
