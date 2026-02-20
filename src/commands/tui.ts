import { mkdirSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import {
  createXmtpClient,
  getCachedPrivateKey,
  migrateLegacyIdentity,
} from "../identity/xmtp.js";
import { createDatabase } from "../storage/db.js";

export function registerTuiCommand(program: Command): void {
  program
    .command("tui", { isDefault: true })
    .description("Launch the full TUI interface (handles login interactively)")
    .argument("[meta-group-id]", "Optional: jump directly to a community")
    .action(async (metaGroupId?: string) => {
      const config = loadConfig();
      mkdirSync(config.dataDir, { recursive: true });

      const { render } = await import("ink");
      const React = await import("react");
      const { App } = await import("../tui/App.js");

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
}
