import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createDatabase } from "../storage/db.js";
import { CommunityManager } from "../community/manager.js";
import {
  createInvite,
  verifyInvite,
  encodeInvite,
  decodeInvite,
} from "../community/invites.js";
import { bootstrap } from "./shared.js";

export function registerInviteCommands(program: Command): void {
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
}
