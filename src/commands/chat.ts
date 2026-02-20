import { createInterface } from "node:readline";
import type { Command } from "commander";
import { createDatabase } from "../storage/db.js";
import { CommunityManager } from "../community/manager.js";
import { sendMessage } from "../messaging/sender.js";
import { MaverickMessageContentType } from "../messaging/codec.js";
import { insertMessage, insertParents } from "../storage/messages.js";
import { sanitize } from "../utils/sanitize.js";
import { bootstrap } from "./shared.js";

export function registerChatCommand(program: Command): void {
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
}
