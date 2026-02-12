import { describe, it, expect } from "vitest";
import {
  replayMetaChannel,
  replayMetaChannelWithSenders,
  applyMetaMessage,
  createEmptyState,
} from "../src/community/state.js";
import type { MetaMessage } from "../src/community/meta-types.js";
import type { SenderTaggedMessage } from "../src/community/state.js";

describe("replayMetaChannel", () => {
  it("builds state from community.config", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Test Community",
        description: "A test",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
    ];

    const state = replayMetaChannel(messages);
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("Test Community");
  });

  it("tracks channels from creation through archival", () => {
    const messages: MetaMessage[] = [
      {
        type: "channel.created",
        channelId: "ch-1",
        name: "general",
        xmtpGroupId: "grp-1",
        permissions: "open",
      },
      {
        type: "channel.created",
        channelId: "ch-2",
        name: "dev",
        xmtpGroupId: "grp-2",
        permissions: "moderated",
        category: "engineering",
      },
      {
        type: "channel.updated",
        channelId: "ch-1",
        name: "general-chat",
      },
      {
        type: "channel.archived",
        channelId: "ch-2",
        reason: "Merged into general",
      },
    ];

    const state = replayMetaChannel(messages);

    expect(state.channels.size).toBe(2);

    const general = state.channels.get("ch-1")!;
    expect(general.name).toBe("general-chat");
    expect(general.archived).toBe(false);

    const dev = state.channels.get("ch-2")!;
    expect(dev.archived).toBe(true);
    expect(dev.category).toBe("engineering");
  });

  it("tracks role assignments", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.role",
        targetDid: "did:plc:alice",
        role: "admin",
      },
      {
        type: "community.role",
        targetDid: "did:plc:bob",
        role: "moderator",
      },
      {
        type: "community.role",
        targetDid: "did:plc:alice",
        role: "owner",
      },
    ];

    const state = replayMetaChannel(messages);
    expect(state.roles.get("did:plc:alice")).toBe("owner");
    expect(state.roles.get("did:plc:bob")).toBe("moderator");
  });

  it("tracks bans and unbans", () => {
    const messages: MetaMessage[] = [
      {
        type: "moderation.action",
        action: "ban",
        targetDid: "did:plc:spammer",
        reason: "spam",
      },
      {
        type: "moderation.action",
        action: "ban",
        targetDid: "did:plc:troll",
      },
      {
        type: "moderation.action",
        action: "unban",
        targetDid: "did:plc:spammer",
      },
    ];

    const state = replayMetaChannel(messages);
    expect(state.bans.has("did:plc:spammer")).toBe(false);
    expect(state.bans.has("did:plc:troll")).toBe(true);
  });

  it("collects announcements", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.announcement",
        title: "Welcome",
        body: "Welcome to the community!",
        priority: "important",
      },
      {
        type: "community.announcement",
        title: "Update",
        body: "New rules posted",
        priority: "normal",
      },
    ];

    const state = replayMetaChannel(messages);
    expect(state.announcements).toHaveLength(2);
    expect(state.announcements[0].title).toBe("Welcome");
  });

  it("handles full community lifecycle", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Maverick HQ",
        settings: {
          allowMemberInvites: false,
          defaultChannelPermissions: "moderated",
        },
      },
      {
        type: "community.role",
        targetDid: "did:plc:founder",
        role: "owner",
      },
      {
        type: "channel.created",
        channelId: "ch-general",
        name: "general",
        xmtpGroupId: "xg-1",
        permissions: "open",
      },
      {
        type: "channel.created",
        channelId: "ch-dev",
        name: "dev",
        xmtpGroupId: "xg-2",
        permissions: "moderated",
        category: "tech",
      },
      {
        type: "community.role",
        targetDid: "did:plc:admin1",
        role: "admin",
      },
      {
        type: "community.announcement",
        title: "Launch!",
        body: "Community is live",
        priority: "important",
      },
      {
        type: "channel.updated",
        channelId: "ch-dev",
        description: "Development discussion",
      },
    ];

    const state = replayMetaChannel(messages);

    expect(state.config!.name).toBe("Maverick HQ");
    expect(state.channels.size).toBe(2);
    expect(state.roles.size).toBe(2);
    expect(state.roles.get("did:plc:founder")).toBe("owner");
    expect(state.roles.get("did:plc:admin1")).toBe("admin");
    expect(state.announcements).toHaveLength(1);
    expect(state.channels.get("ch-dev")!.description).toBe(
      "Development discussion",
    );
  });
});

describe("applyMetaMessage", () => {
  it("mutates state in place", () => {
    const state = createEmptyState();
    applyMetaMessage(state, {
      type: "community.config",
      name: "Test",
      settings: {
        allowMemberInvites: true,
        defaultChannelPermissions: "open",
      },
    });
    expect(state.config!.name).toBe("Test");
  });
});

describe("community.snapshot", () => {
  it("replaces state wholesale from a snapshot", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.snapshot",
        config: {
          name: "Snapshot Community",
          description: "From snapshot",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        channels: [
          {
            channelId: "ch-1",
            name: "general",
            xmtpGroupId: "xg-1",
            permissions: "open",
          },
          {
            channelId: "ch-2",
            name: "dev",
            xmtpGroupId: "xg-2",
            permissions: "moderated",
          },
        ],
        roles: [
          { did: "did:plc:alice", role: "owner" },
          { did: "did:plc:bob", role: "member" },
        ],
        bans: ["did:plc:spammer"],
      },
    ];

    const state = replayMetaChannel(messages);

    expect(state.config!.name).toBe("Snapshot Community");
    expect(state.config!.type).toBe("community.config");
    expect(state.channels.size).toBe(2);
    expect(state.channels.get("ch-1")!.name).toBe("general");
    expect(state.channels.get("ch-2")!.name).toBe("dev");
    expect(state.roles.get("did:plc:alice")).toBe("owner");
    expect(state.roles.get("did:plc:bob")).toBe("member");
    expect(state.bans.has("did:plc:spammer")).toBe(true);
    expect(state.bans.size).toBe(1);
  });

  it("snapshot clears previous state before applying", () => {
    const messages: MetaMessage[] = [
      // Pre-snapshot events
      {
        type: "community.config",
        name: "Old Name",
        settings: {
          allowMemberInvites: false,
          defaultChannelPermissions: "moderated",
        },
      },
      {
        type: "channel.created",
        channelId: "ch-old",
        name: "old-channel",
        xmtpGroupId: "xg-old",
        permissions: "open",
      },
      {
        type: "community.role",
        targetDid: "did:plc:removed",
        role: "admin",
      },
      // Snapshot replaces everything
      {
        type: "community.snapshot",
        config: {
          name: "New Name",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        channels: [
          {
            channelId: "ch-new",
            name: "new-channel",
            xmtpGroupId: "xg-new",
            permissions: "open",
          },
        ],
        roles: [{ did: "did:plc:alice", role: "owner" }],
        bans: [],
      },
    ];

    const state = replayMetaChannel(messages);

    // Old state is gone
    expect(state.config!.name).toBe("New Name");
    expect(state.channels.has("ch-old")).toBe(false);
    expect(state.roles.has("did:plc:removed")).toBe(false);

    // New state applied
    expect(state.channels.size).toBe(1);
    expect(state.channels.get("ch-new")!.name).toBe("new-channel");
    expect(state.roles.get("did:plc:alice")).toBe("owner");
  });

  it("events after snapshot stack on top correctly", () => {
    const messages: MetaMessage[] = [
      {
        type: "community.snapshot",
        config: {
          name: "Base",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        channels: [
          {
            channelId: "ch-1",
            name: "general",
            xmtpGroupId: "xg-1",
            permissions: "open",
          },
        ],
        roles: [{ did: "did:plc:alice", role: "owner" }],
        bans: [],
      },
      // Post-snapshot events
      {
        type: "channel.created",
        channelId: "ch-2",
        name: "dev",
        xmtpGroupId: "xg-2",
        permissions: "moderated",
      },
      {
        type: "channel.updated",
        channelId: "ch-1",
        name: "lobby",
      },
      {
        type: "community.role",
        targetDid: "did:plc:bob",
        role: "moderator",
      },
      {
        type: "moderation.action",
        action: "ban",
        targetDid: "did:plc:troll",
      },
    ];

    const state = replayMetaChannel(messages);

    expect(state.channels.size).toBe(2);
    expect(state.channels.get("ch-1")!.name).toBe("lobby");
    expect(state.channels.get("ch-2")!.name).toBe("dev");
    expect(state.roles.size).toBe(2);
    expect(state.roles.get("did:plc:bob")).toBe("moderator");
    expect(state.bans.has("did:plc:troll")).toBe(true);
  });
});

// ─── Sender authorization tests ──────────────────────────────────────────────
// These test replayMetaChannelWithSenders which validates sender permissions.
// The first config sender is implicitly the creator (super_admin).
// Only admins/owners can perform privileged operations.

describe("replayMetaChannelWithSenders — sender authorization", () => {
  const CREATOR_INBOX = "inbox-creator";
  const ADMIN_INBOX = "inbox-admin";
  const MEMBER_INBOX = "inbox-member";

  function tag(message: MetaMessage, senderInboxId: string): SenderTaggedMessage {
    return { message, senderInboxId };
  }

  // Helper: standard community bootstrap (config + owner role + admin role)
  function bootstrapMessages(): SenderTaggedMessage[] {
    return [
      tag(
        {
          type: "community.config",
          name: "Auth Test",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "community.role",
          targetDid: CREATOR_INBOX,
          role: "owner",
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "community.role",
          targetDid: ADMIN_INBOX,
          role: "admin",
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "community.role",
          targetDid: MEMBER_INBOX,
          role: "member",
        },
        CREATOR_INBOX,
      ),
    ];
  }

  it("rejects community.config from a non-admin sender", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.config",
          name: "Hijacked!",
          settings: {
            allowMemberInvites: false,
            defaultChannelPermissions: "moderated",
          },
        },
        MEMBER_INBOX, // member tries to change config
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // The config should still be the original, not "Hijacked!"
    expect(state.config!.name).toBe("Auth Test");
  });

  it("rejects community.snapshot from a non-admin sender", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.snapshot",
          config: {
            name: "Evil Snapshot",
            settings: {
              allowMemberInvites: false,
              defaultChannelPermissions: "moderated",
            },
          },
          channels: [],
          roles: [{ did: MEMBER_INBOX, role: "owner" }],
          bans: [],
        },
        MEMBER_INBOX, // member tries to nuke state
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Snapshot should be ignored — state stays as bootstrapped
    expect(state.config!.name).toBe("Auth Test");
    expect(state.roles.get(CREATOR_INBOX)).toBe("owner");
    expect(state.roles.get(MEMBER_INBOX)).toBe("member"); // not "owner"
  });

  it("rejects community.role assignment from a non-admin sender", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: MEMBER_INBOX,
          role: "owner", // member tries to promote themselves
        },
        MEMBER_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Member should still be a member, not owner
    expect(state.roles.get(MEMBER_INBOX)).toBe("member");
  });

  it("rejects channel.created from a non-admin sender", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "channel.created",
          channelId: "ch-evil",
          name: "evil-channel",
          xmtpGroupId: "xg-evil",
          permissions: "open",
        },
        MEMBER_INBOX, // member tries to create a channel
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Channel should not exist
    expect(state.channels.has("ch-evil")).toBe(false);
  });

  it("accepts community.config from the creator", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.config",
          name: "Updated by Creator",
          settings: {
            allowMemberInvites: false,
            defaultChannelPermissions: "moderated",
          },
        },
        CREATOR_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.config!.name).toBe("Updated by Creator");
  });

  it("accepts channel.created from an admin", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "channel.created",
          channelId: "ch-admin",
          name: "admin-channel",
          xmtpGroupId: "xg-admin",
          permissions: "open",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.channels.has("ch-admin")).toBe(true);
    expect(state.channels.get("ch-admin")!.name).toBe("admin-channel");
  });

  it("accepts community.snapshot from an admin", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.snapshot",
          config: {
            name: "Admin Snapshot",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          },
          channels: [
            {
              channelId: "ch-snap",
              name: "snapped",
              xmtpGroupId: "xg-snap",
              permissions: "open",
            },
          ],
          roles: [
            { did: CREATOR_INBOX, role: "owner" },
            { did: ADMIN_INBOX, role: "admin" },
          ],
          bans: [],
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.config!.name).toBe("Admin Snapshot");
    expect(state.channels.has("ch-snap")).toBe(true);
  });

  it("accepts moderation.action from a moderator", () => {
    const MOD_INBOX = "inbox-moderator";
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: MOD_INBOX,
          role: "moderator",
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: "did:plc:spammer",
          reason: "spam",
        },
        MOD_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.bans.has("did:plc:spammer")).toBe(true);
  });

  it("rejects moderation.action from a regular member", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: "did:plc:someone",
          reason: "trying to ban",
        },
        MEMBER_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.bans.has("did:plc:someone")).toBe(false);
  });

  it("rejects announcement from a regular member", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.announcement",
          title: "Fake Announcement",
          body: "I am not an admin",
          priority: "important",
        },
        MEMBER_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.announcements).toHaveLength(0);
  });

  it("authorizes user when role assigned via targetInboxId even if targetDid is a DID", () => {
    // A role assignment using a real DID in targetDid but providing targetInboxId
    // should authorize the user by inboxId
    const msgs = [
      ...bootstrapMessages(),
      // Creator assigns admin role to a user, providing both DID and inboxId
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:newadmin", // a DID (won't match senderInboxId)
          targetInboxId: "inbox-newadmin", // the inboxId (will match)
          role: "admin",
        },
        CREATOR_INBOX,
      ),
      // The new admin tries to create a channel using their inboxId
      tag(
        {
          type: "channel.created",
          channelId: "ch-by-newadmin",
          name: "new-admin-channel",
          xmtpGroupId: "xg-newadmin",
          permissions: "open",
        },
        "inbox-newadmin", // sends from their inboxId
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // The channel should exist because inbox-newadmin was authorized via targetInboxId
    expect(state.channels.has("ch-by-newadmin")).toBe(true);
    // The roles map should still use targetDid for display
    expect(state.roles.get("did:plc:newadmin")).toBe("admin");
  });

  it("first config message is always accepted (creator bootstrap)", () => {
    // Even with an unknown sender, the very first config is accepted
    const msgs: SenderTaggedMessage[] = [
      tag(
        {
          type: "community.config",
          name: "New Community",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        "inbox-unknown",
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.config!.name).toBe("New Community");
  });

  it("admin cannot escalate self to owner role", () => {
    const msgs = [
      ...bootstrapMessages(),
      // Admin tries to promote themselves to owner
      tag(
        {
          type: "community.role",
          targetDid: ADMIN_INBOX,
          role: "owner",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Admin should still be admin, not owner
    expect(state.roles.get(ADMIN_INBOX)).toBe("admin");
  });

  it("admin cannot promote another user to owner", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:someone",
          role: "owner",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.roles.has("did:plc:someone")).toBe(false);
  });

  it("admin can assign moderator and member roles", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:newmod",
          role: "moderator",
        },
        ADMIN_INBOX,
      ),
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:newmem",
          role: "member",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.roles.get("did:plc:newmod")).toBe("moderator");
    expect(state.roles.get("did:plc:newmem")).toBe("member");
  });

  it("creator can assign owner role", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:co-owner",
          role: "owner",
        },
        CREATOR_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.roles.get("did:plc:co-owner")).toBe("owner");
  });

  it("snapshot with inboxId preserves auth context for post-snapshot operations", () => {
    const msgs: SenderTaggedMessage[] = [
      // Bootstrap: config establishes creator
      tag(
        {
          type: "community.config",
          name: "Test",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        CREATOR_INBOX,
      ),
      // Snapshot includes inboxId in roles — this is what allows
      // post-snapshot auth to work correctly
      tag(
        {
          type: "community.snapshot",
          config: {
            name: "Snapshotted",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          },
          channels: [],
          roles: [
            { did: "did:plc:creator", inboxId: CREATOR_INBOX, role: "owner" },
            { did: "did:plc:admin", inboxId: ADMIN_INBOX, role: "admin" },
          ],
          bans: [],
        },
        CREATOR_INBOX,
      ),
      // Admin (authorized via inboxId from snapshot) creates a channel
      tag(
        {
          type: "channel.created",
          channelId: "ch-post-snap",
          name: "post-snapshot-channel",
          xmtpGroupId: "xg-ps",
          permissions: "open",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.config!.name).toBe("Snapshotted");
    // The admin's channel creation should succeed because the snapshot
    // included their inboxId in the auth context
    expect(state.channels.has("ch-post-snap")).toBe(true);
  });

  it("banned users' meta messages are silently ignored (ban by inboxId)", () => {
    const EVIL_INBOX = "inbox-evil";
    const msgs = [
      ...bootstrapMessages(),
      // Also give them admin role first (they had it before being banned)
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:evil",
          targetInboxId: EVIL_INBOX,
          role: "admin",
        },
        CREATOR_INBOX,
      ),
      // Creator bans the evil user by DID with inboxId for enforcement
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: "did:plc:evil",
          targetInboxId: EVIL_INBOX,
          reason: "malicious behavior",
        },
        CREATOR_INBOX,
      ),
      // Banned user tries to create a channel
      tag(
        {
          type: "channel.created",
          channelId: "ch-evil",
          name: "evil-channel",
          xmtpGroupId: "xg-evil",
          permissions: "open",
        },
        EVIL_INBOX,
      ),
      // Banned user tries to change config
      tag(
        {
          type: "community.config",
          name: "Hijacked by banned user!",
          settings: {
            allowMemberInvites: false,
            defaultChannelPermissions: "moderated",
          },
        },
        EVIL_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Banned user's channel creation should be rejected
    expect(state.channels.has("ch-evil")).toBe(false);
    // Config should remain unchanged
    expect(state.config!.name).toBe("Auth Test");
    // bannedInboxIds should track the inboxId
    expect(state.bannedInboxIds.has(EVIL_INBOX)).toBe(true);
  });

  it("admin cannot demote an owner via role assignment", () => {
    const OWNER_INBOX = "inbox-owner-2";
    const msgs = [
      ...bootstrapMessages(),
      // Creator assigns owner role to another user
      tag(
        {
          type: "community.role",
          targetDid: OWNER_INBOX,
          targetInboxId: OWNER_INBOX,
          role: "owner",
        },
        CREATOR_INBOX,
      ),
      // Admin tries to demote the owner to member
      tag(
        {
          type: "community.role",
          targetDid: OWNER_INBOX,
          targetInboxId: OWNER_INBOX,
          role: "member",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Owner should still be owner (admin can't demote them)
    expect(state.roles.get(OWNER_INBOX)).toBe("owner");
  });

  it("admin cannot demote a peer admin", () => {
    const ADMIN2_INBOX = "inbox-admin-2";
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: ADMIN2_INBOX,
          targetInboxId: ADMIN2_INBOX,
          role: "admin",
        },
        CREATOR_INBOX,
      ),
      // Admin tries to demote peer admin to member
      tag(
        {
          type: "community.role",
          targetDid: ADMIN2_INBOX,
          targetInboxId: ADMIN2_INBOX,
          role: "member",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Admin2 should still be admin (peer can't demote)
    expect(state.roles.get(ADMIN2_INBOX)).toBe("admin");
  });

  it("admin can demote a moderator", () => {
    const MOD_INBOX = "inbox-mod";
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: MOD_INBOX,
          targetInboxId: MOD_INBOX,
          role: "moderator",
        },
        CREATOR_INBOX,
      ),
      // Admin can demote a moderator (below their level)
      tag(
        {
          type: "community.role",
          targetDid: MOD_INBOX,
          targetInboxId: MOD_INBOX,
          role: "member",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.roles.get(MOD_INBOX)).toBe("member");
  });

  it("moderator cannot ban an admin", () => {
    const MOD_INBOX = "inbox-mod";
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: MOD_INBOX,
          targetInboxId: MOD_INBOX,
          role: "moderator",
        },
        CREATOR_INBOX,
      ),
      // Moderator tries to ban the admin
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: ADMIN_INBOX,
          reason: "coup attempt",
        },
        MOD_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Admin should NOT be banned
    expect(state.bans.has(ADMIN_INBOX)).toBe(false);
  });

  it("moderator can ban a regular member", () => {
    const MOD_INBOX = "inbox-mod";
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: MOD_INBOX,
          targetInboxId: MOD_INBOX,
          role: "moderator",
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: MEMBER_INBOX,
          targetInboxId: MEMBER_INBOX,
          reason: "spam",
        },
        MOD_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.bans.has(MEMBER_INBOX)).toBe(true);
    expect(state.bannedInboxIds.has(MEMBER_INBOX)).toBe(true);
  });

  it("snapshot without inboxId falls back to did for auth (backward compat)", () => {
    // When inboxId is not provided, fall back to using did as the auth key.
    // This tests backward compatibility with older snapshots.
    const msgs: SenderTaggedMessage[] = [
      tag(
        {
          type: "community.config",
          name: "Test",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "community.snapshot",
          config: {
            name: "Old-style Snapshot",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          },
          channels: [],
          roles: [
            { did: CREATOR_INBOX, role: "owner" },
            // No inboxId — falls back to did as auth key.
            // Only works if did happens to equal the senderInboxId.
            { did: ADMIN_INBOX, role: "admin" },
          ],
          bans: [],
        },
        CREATOR_INBOX,
      ),
      tag(
        {
          type: "channel.created",
          channelId: "ch-compat",
          name: "compat-channel",
          xmtpGroupId: "xg-c",
          permissions: "open",
        },
        ADMIN_INBOX, // This works because did == inboxId in this case
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.channels.has("ch-compat")).toBe(true);
  });

  it("admin cannot demote user registered by inboxId when using DID lookup", () => {
    // Target was registered with targetInboxId. An admin tries to demote via
    // targetDid only — the role lookup must still find the target's current role.
    const msgs = [
      ...bootstrapMessages(),
      // Creator assigns "other-admin" at admin level using inboxId
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:otheradmin",
          targetInboxId: "inbox-otheradmin",
          role: "admin",
        },
        CREATOR_INBOX,
      ),
      // ADMIN_INBOX tries to demote other-admin using targetInboxId
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:otheradmin",
          targetInboxId: "inbox-otheradmin",
          role: "member",
        },
        ADMIN_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Peer admin should NOT have been demoted
    expect(state.roles.get("did:plc:otheradmin")).toBe("admin");
  });

  it("moderator cannot ban user registered by inboxId via targetInboxId", () => {
    // Ensure moderation ban hierarchy check works when the target's role
    // was stored under their inboxId key in authCtx.
    const msgs = [
      ...bootstrapMessages(),
      // Creator assigns moderator
      tag(
        {
          type: "community.role",
          targetDid: "did:plc:mod",
          targetInboxId: "inbox-mod",
          role: "moderator",
        },
        CREATOR_INBOX,
      ),
      // Moderator tries to ban an admin (whose role is stored under ADMIN_INBOX)
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: ADMIN_INBOX,
          targetInboxId: ADMIN_INBOX,
        },
        "inbox-mod",
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Admin should NOT be banned (moderator < admin)
    expect(state.bans.has(ADMIN_INBOX)).toBe(false);
  });

  it("ignores role assignment with empty targetDid", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: "",
          role: "owner",
        },
        CREATOR_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    // Empty-string key should not be in the roles map
    expect(state.roles.has("")).toBe(false);
  });

  it("ignores role assignment with whitespace-only targetDid", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "community.role",
          targetDid: "   ",
          role: "admin",
        },
        CREATOR_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.roles.has("   ")).toBe(false);
  });

  it("ignores ban with whitespace-only targetDid", () => {
    const msgs = [
      ...bootstrapMessages(),
      tag(
        {
          type: "moderation.action",
          action: "ban",
          targetDid: "  ",
        },
        CREATOR_INBOX,
      ),
    ];

    const state = replayMetaChannelWithSenders(msgs);
    expect(state.bans.has("  ")).toBe(false);
    expect(state.bans.size).toBe(0);
  });
});
