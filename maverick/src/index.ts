import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { createBlueskySession } from "./identity/atproto.js";
import {
  createXmtpClient,
  getOrCreatePrivateKey,
} from "./identity/xmtp.js";
import { publishInboxRecord } from "./identity/bridge.js";
import {
  resolveHandleToInbox,
  verifyInboxAssociation,
} from "./identity/resolver.js";
import { createDatabase } from "./storage/db.js";
import { CommunityManager } from "./community/manager.js";
import { getChannels } from "./storage/community-cache.js";
import {
  createInvite,
  verifyInvite,
  encodeInvite,
  decodeInvite,
} from "./community/invites.js";
import { sendMessage } from "./messaging/sender.js";
import { MaverickMessageCodec, MaverickMessageContentType } from "./messaging/codec.js";
import { insertMessage, insertParents } from "./storage/messages.js";
import { saveSession, clearSession } from "./storage/session.js";
import { sanitize } from "./utils/sanitize.js";
import type { Client } from "@xmtp/node-sdk";
import type { Config } from "./config.js";
import type { BlueskySession } from "./identity/atproto.js";

const program = new Command();

program
  .name("maverick")
  .description("Private community chat on ATProto + XMTP")
  .version("0.1.0");

// Shared bootstrap: authenticate + create clients
async function bootstrap(): Promise<{
  config: Config;
  bsky: BlueskySession;
  xmtp: Client;
  privateKey: `0x${string}`;
}> {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });

  const bsky = await createBlueskySession(config);
  const privateKey = await getOrCreatePrivateKey(bsky.handle, config.bluesky.password);
  const xmtp = await createXmtpClient(config, privateKey);

  return { config, bsky, xmtp, privateKey };
}

// ─── login ────────────────────────────────────────────────────────────────

program
  .command("login")
  .description(
    "Authenticate with Bluesky + create XMTP client + publish identity bridge",
  )
  .action(async () => {
    const { config, bsky, xmtp } = await bootstrap();

    console.log(`Logged in as ${bsky.handle} (${bsky.did})`);
    console.log(`XMTP Inbox ID: ${xmtp.inboxId}`);
    console.log(`Installation ID: ${xmtp.installationId}`);

    console.log("Publishing identity bridge record...");
    await publishInboxRecord(bsky.agent, xmtp);
    console.log("Published org.xmtp.inbox record on PDS");

    try {
      saveSession(bsky.handle, config.bluesky.password);
      console.log("Session saved to OS keychain");
    } catch {
      // Non-fatal: keychain may be unavailable
    }

    console.log("\nLogin complete!");
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

    const { getPublishedInboxRecord } = await import("./identity/bridge.js");
    const record = await getPublishedInboxRecord(bsky.agent, result.did);
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
    const { config, xmtp } = await bootstrap();

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
    const msgCodec = new MaverickMessageCodec();

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
      const privateKey = await getOrCreatePrivateKey(bsky.handle, config.bluesky.password);
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
      // Full-workflow mode: interactive login → community list → chat
      render(
        React.createElement(App, {
          initialConfig: config,
        }),
      );
    }
  });

program.parse();
