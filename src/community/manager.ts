import { randomUUID } from "node:crypto";
import type { Client, Group, DecodedMessage } from "@xmtp/node-sdk";
import type Database from "better-sqlite3";
import { MetaMessageCodec, MetaMessageContentType } from "./meta-codec.js";
import { MetaMessageSchema, type MetaMessage } from "./meta-types.js";
import {
  replayMetaChannelWithSenders,
  type CommunityState,
  type ChannelState,
  type SenderTaggedMessage,
} from "./state.js";
import {
  upsertCommunity,
  upsertChannel,
  upsertRole,
  getCommunity,
  archiveChannel as archiveChannelDb,
} from "../storage/community-cache.js";

const metaCodec = new MetaMessageCodec();

export class CommunityManager {
  constructor(
    private xmtpClient: Client,
    private db: Database.Database,
  ) {}

  async createCommunity(
    name: string,
    description?: string,
  ): Promise<string> {
    // Create the meta channel XMTP group (just this client for now)
    const metaGroup = await this.xmtpClient.conversations.createGroup([], {
      groupName: `[meta] ${name}`,
      groupDescription: `Meta channel for ${name}`,
    });

    const metaGroupId = metaGroup.id;

    // Send initial config
    const configMsg: MetaMessage = {
      type: "community.config",
      name,
      description,
      settings: {
        allowMemberInvites: true,
        defaultChannelPermissions: "open",
      },
    };
    await this.sendMetaMessage(metaGroup, configMsg);

    // Set creator as owner — include both DID-style and inboxId for auth
    const ownerMsg: MetaMessage = {
      type: "community.role",
      targetDid: this.xmtpClient.inboxId,
      targetInboxId: this.xmtpClient.inboxId,
      role: "owner",
    };
    await this.sendMetaMessage(metaGroup, ownerMsg);

    // Cache in local DB
    upsertCommunity(this.db, {
      id: metaGroupId,
      name,
      description,
      configJson: JSON.stringify(configMsg),
    });

    return metaGroupId;
  }

  async createChannel(
    metaGroupId: string,
    name: string,
    permissions: "open" | "moderated" | "read-only" = "open",
    description?: string,
    category?: string,
  ): Promise<string> {
    // Create a new XMTP group for the channel
    const channelGroup = await this.xmtpClient.conversations.createGroup(
      [],
      {
        groupName: `#${name}`,
        groupDescription: description,
      },
    );

    const channelId = randomUUID();

    // Announce the new channel on the meta channel
    const metaGroup = await this.getGroupById(metaGroupId);
    const channelCreatedMsg: MetaMessage = {
      type: "channel.created",
      channelId,
      name,
      description,
      xmtpGroupId: channelGroup.id,
      category,
      permissions,
    };
    await this.sendMetaMessage(metaGroup, channelCreatedMsg);

    // Cache locally
    upsertChannel(this.db, {
      id: channelId,
      communityId: metaGroupId,
      xmtpGroupId: channelGroup.id,
      name,
      description,
      category,
      permissions,
    });

    return channelId;
  }

  async addMember(
    metaGroupId: string,
    memberInboxId: string,
  ): Promise<void> {
    // Sync state BEFORE adding member (so we know current config + channels)
    const state = await this.syncCommunityState(metaGroupId);

    // Check ban list — do not add banned users (check both DID and inboxId ban sets)
    if (state.bans.has(memberInboxId) || state.bannedInboxIds.has(memberInboxId)) {
      throw new Error(
        `Cannot add member: ${memberInboxId} is banned from this community.`,
      );
    }

    // Add to meta channel
    const metaGroup = await this.getGroupById(metaGroupId);
    await metaGroup.addMembers([memberInboxId]);

    // Send community.config first to establish creator authority for the
    // new member (they can't see pre-join messages due to MLS forward secrecy).
    // Without this, the snapshot would be rejected because no creator exists.
    if (state.config) {
      await this.sendMetaMessage(metaGroup, state.config);
    }

    // Then send a state snapshot so the new member sees current channels/roles.
    if (state.config) {
      const snapshot: MetaMessage = {
        type: "community.snapshot",
        config: {
          name: state.config.name,
          description: state.config.description,
          settings: state.config.settings,
        },
        channels: [...state.channels.values()]
          .filter((ch) => !ch.archived)
          .map((ch) => ({
            channelId: ch.channelId,
            name: ch.name,
            description: ch.description,
            xmtpGroupId: ch.xmtpGroupId,
            category: ch.category,
            permissions: ch.permissions,
          })),
        roles: [...state.roles.entries()].map(([did, role]) => ({
          did,
          inboxId: state.roleInboxIds.get(did),
          role,
        })),
        bans: [...state.bans],
        bannedInboxIds: [...state.bannedInboxIds],
      };
      await this.sendMetaMessage(metaGroup, snapshot);
    }

    // Add to all non-archived chat channels
    for (const [, channel] of state.channels) {
      if (channel.archived) continue;
      try {
        const channelGroup = await this.getGroupById(channel.xmtpGroupId);
        await channelGroup.addMembers([memberInboxId]);
      } catch (err) {
        console.error(
          `Failed to add member to channel ${channel.name}:`,
          err,
        );
      }
    }
  }

  async removeMember(
    metaGroupId: string,
    memberInboxId: string,
  ): Promise<void> {
    const state = await this.syncCommunityState(metaGroupId);

    // Remove from all chat channels
    for (const [, channel] of state.channels) {
      try {
        const channelGroup = await this.getGroupById(channel.xmtpGroupId);
        await channelGroup.removeMembers([memberInboxId]);
      } catch {
        // May not be in channel
      }
    }

    // Remove from meta channel last
    const metaGroup = await this.getGroupById(metaGroupId);
    await metaGroup.removeMembers([memberInboxId]);
  }

  async sendMetaMessage(
    group: Group,
    message: MetaMessage,
  ): Promise<void> {
    const encoded = metaCodec.encode(message);
    await group.send(encoded);
  }

  async syncCommunityState(
    metaGroupId: string,
  ): Promise<CommunityState> {
    // Sync conversation list from network first (discovers groups we've been added to)
    await this.xmtpClient.conversations.sync();

    const metaGroup = await this.getGroupById(metaGroupId);
    await metaGroup.sync();

    const messages = await metaGroup.messages();
    const taggedMessages: SenderTaggedMessage[] = [];

    for (const msg of messages) {
      // With codecs registered, the SDK decodes content automatically.
      // msg.content will be a MetaMessage object for our content type.
      if (
        msg.contentType?.authorityId === MetaMessageContentType.authorityId &&
        msg.contentType?.typeId === MetaMessageContentType.typeId
      ) {
        try {
          // Re-validate through Zod even though the codec should have
          // already parsed. This guards against SDK behavior changes or
          // codec registration issues where msg.content bypasses decode().
          const result = MetaMessageSchema.safeParse(msg.content);
          if (result.success) {
            taggedMessages.push({
              message: result.data,
              senderInboxId: msg.senderInboxId,
            });
          }
        } catch {
          // Skip malformed meta messages
        }
      } else {
        // Silently skip XMTP system messages (group_updated, etc.)
        // and any other non-meta content types — these are expected.
      }
    }

    // Note: if messages exist but none matched meta content type,
    // this is normal for newly joined members (MLS forward secrecy)
    // or groups that only have system messages so far.

    const state = replayMetaChannelWithSenders(taggedMessages);

    // Update local cache
    if (state.config) {
      upsertCommunity(this.db, {
        id: metaGroupId,
        name: state.config.name,
        description: state.config.description,
        configJson: JSON.stringify(state.config),
      });
    }

    for (const [, ch] of state.channels) {
      upsertChannel(this.db, {
        id: ch.channelId,
        communityId: metaGroupId,
        xmtpGroupId: ch.xmtpGroupId,
        name: ch.name,
        description: ch.description,
        category: ch.category,
        permissions: ch.permissions,
        archived: ch.archived,
      });
    }

    for (const [did, role] of state.roles) {
      upsertRole(this.db, metaGroupId, did, role);
    }

    return state;
  }

  async listCommunities(): Promise<
    { groupId: string; name: string }[]
  > {
    await this.xmtpClient.conversations.sync();
    const groups = this.xmtpClient.conversations.listGroups();
    const communities: { groupId: string; name: string }[] = [];

    for (const group of groups) {
      // Meta channels are identified by their name prefix "[meta] ".
      // As a second check, verify the group contains at least one valid
      // meta message (community.config or community.snapshot) so that
      // a stray group that happens to match the prefix isn't listed.
      if (!group.name.startsWith("[meta] ")) continue;

      const communityName = group.name.slice("[meta] ".length);

      // Check local DB cache first (fast path)
      const cached = getCommunity(this.db, group.id);
      if (cached) {
        communities.push({ groupId: group.id, name: cached.name });
        continue;
      }

      // No cache — probe the group for a meta message to confirm it's real.
      // Sync + fetch a small number of messages to check.
      try {
        await group.sync();
        const msgs = await group.messages({ limit: 5 });
        const hasMeta = msgs.some(
          (m) =>
            m.contentType?.authorityId === MetaMessageContentType.authorityId &&
            m.contentType?.typeId === MetaMessageContentType.typeId,
        );
        if (hasMeta) {
          communities.push({ groupId: group.id, name: communityName });
        }
      } catch {
        // Group may be inaccessible — skip silently
      }
    }

    return communities;
  }

  /**
   * Recovers all communities after key restoration on a new device.
   *
   * Performs a full network sync to discover all groups the user belongs to,
   * then replays each community's meta channel to rebuild the local cache.
   * Optionally requests message history from other installations.
   *
   * Individual community sync failures are logged but do not abort the
   * overall recovery process.
   */
  async recoverAllCommunities(): Promise<{
    communities: { groupId: string; name: string }[];
    channelsRecovered: number;
    historyRequested: boolean;
  }> {
    // 1. Full sync of all groups + messages from the XMTP network
    await this.xmtpClient.conversations.syncAll();

    // 2. Discover meta channels (communities we belong to)
    const communities = await this.listCommunities();

    // 3. For each community, replay meta channel to rebuild local cache
    let channelsRecovered = 0;
    for (const community of communities) {
      try {
        const state = await this.syncCommunityState(community.groupId);
        for (const [, ch] of state.channels) {
          if (!ch.archived) {
            channelsRecovered++;
          }
        }
      } catch (err) {
        console.error(
          `Failed to sync community "${community.name}" (${community.groupId}):`,
          err,
        );
      }
    }

    // 4. Request message history from other installations
    let historyRequested = false;
    try {
      await this.xmtpClient.sendSyncRequest();
      historyRequested = true;
    } catch {
      // sendSyncRequest may fail if no other installations exist or
      // the method is unavailable — this is non-fatal for recovery.
    }

    return { communities, channelsRecovered, historyRequested };
  }

  private async getGroupById(groupId: string): Promise<Group> {
    const conversation =
      await this.xmtpClient.conversations.getConversationById(groupId);
    if (!conversation) {
      throw new Error(`Group not found: ${groupId}`);
    }
    // The SDK returns Group | Dm, we expect a Group here
    return conversation as Group;
  }
}
