import type { Command } from "commander";
import { loadConfig } from "../config.js";
import {
  getLegacyInboxRecord,
} from "../identity/bridge.js";
import {
  resolveHandleToInbox,
  verifyInboxAssociation,
} from "../identity/resolver.js";
import { CommunityManager } from "../community/manager.js";
import { bootstrap, withDatabase } from "./shared.js";

export function registerCommunityCommands(program: Command): void {
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
      await withDatabase(config.sqlitePath, async (db) => {
        const manager = new CommunityManager(xmtp, db);

        console.log(`Creating community "${name}"...`);
        const metaGroupId = await manager.createCommunity(name, opts.description);
        console.log(`Community created! Meta group ID: ${metaGroupId}`);

        console.log("Creating #general channel...");
        const channelId = await manager.createChannel(
          metaGroupId,
          "general",
          "open",
          "General discussion",
        );
        console.log(`Channel created! ID: ${channelId}`);
      });
    });

  // ─── channels ─────────────────────────────────────────────────────────────

  program
    .command("channels")
    .description("List channels in a community")
    .argument("<meta-group-id>", "Meta channel group ID")
    .action(async (metaGroupId: string) => {
      const { config, xmtp } = await bootstrap();
      await withDatabase(config.sqlitePath, async (db) => {
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
      });
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
        await withDatabase(config.sqlitePath, async (db) => {
          const manager = new CommunityManager(xmtp, db);

          const validPerms = ["open", "moderated", "read-only"] as const;
          if (!validPerms.includes(opts.permissions as typeof validPerms[number])) {
            console.error(
              `Invalid permissions: "${opts.permissions}". Must be one of: ${validPerms.join(", ")}`,
            );
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
        });
      },
    );

  // ─── add-member ───────────────────────────────────────────────────────────

  program
    .command("add-member")
    .description("Add a member to a community by their XMTP inbox ID")
    .argument("<meta-group-id>", "Meta channel group ID")
    .argument("<inbox-id>", "Member's XMTP inbox ID")
    .action(async (metaGroupId: string, inboxId: string) => {
      const { config, xmtp } = await bootstrap();
      await withDatabase(config.sqlitePath, async (db) => {
        const manager = new CommunityManager(xmtp, db);

        console.log(`Adding member ${inboxId} to community...`);
        await manager.addMember(metaGroupId, inboxId);
        console.log("Member added to meta channel and all channels.");
      });
    });

  // ─── communities ──────────────────────────────────────────────────────────

  program
    .command("communities")
    .description("List communities you belong to")
    .action(async () => {
      const { xmtp } = await bootstrap();
      await withDatabase(loadConfig().sqlitePath, async (db) => {
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
      });
    });
}
