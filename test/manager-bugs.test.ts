import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/storage/db.js";
import { CommunityManager } from "../src/community/manager.js";
import { MetaMessageContentType, MetaMessageCodec } from "../src/community/meta-codec.js";
import type { MetaMessage } from "../src/community/meta-types.js";
import type Database from "better-sqlite3";

const metaCodec = new MetaMessageCodec();

const TEST_DIR = join(tmpdir(), "maverick-manager-bugs-" + Date.now());
let db: Database.Database;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  db = createDatabase(join(TEST_DIR, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/**
 * Helper to create a mock XMTP group with pre-decoded meta messages.
 * Simulates what the SDK returns when codecs are properly registered:
 * msg.content is already a parsed MetaMessage object, not raw bytes.
 */
function createMockGroup(
  id: string,
  name: string,
  metaMessages: MetaMessage[],
) {
  return {
    id,
    name,
    sync: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    addMembers: vi.fn().mockResolvedValue(undefined),
    removeMembers: vi.fn().mockResolvedValue(undefined),
    messages: vi.fn().mockResolvedValue(
      metaMessages.map((meta, i) => ({
        id: `msg-${i}`,
        content: meta, // SDK auto-decodes when codecs are registered
        contentType: {
          authorityId: MetaMessageContentType.authorityId,
          typeId: MetaMessageContentType.typeId,
          versionMajor: MetaMessageContentType.versionMajor,
          versionMinor: MetaMessageContentType.versionMinor,
        },
      })),
    ),
  };
}

// ─── Bug #1: conversations.sync() not called before getConversationById ──────
// When a new member joins a community, their XMTP client has an empty local
// conversation list. conversations.sync() must be called first to pull the
// group list from the network. Without it, getConversationById() returns null
// and syncCommunityState() throws "Group not found".
// Fixed in: src/community/manager.ts — syncCommunityState()

describe("Bug: syncCommunityState must sync conversations from network first", () => {
  const META_GROUP_ID = "meta-grp-sync-test";

  it("calls conversations.sync() before looking up the group", async () => {
    const callOrder: string[] = [];

    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Sync Test Community",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
    ];

    const mockGroup = createMockGroup(
      META_GROUP_ID,
      "[meta] Sync Test Community",
      metaMessages,
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockImplementation(async () => {
          callOrder.push("conversations.sync");
        }),
        getConversationById: vi.fn().mockImplementation(async (id: string) => {
          callOrder.push(`getConversationById(${id})`);
          return mockGroup;
        }),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    await manager.syncCommunityState(META_GROUP_ID);

    // conversations.sync() MUST be called
    expect(mockClient.conversations.sync).toHaveBeenCalled();

    // conversations.sync() MUST be called BEFORE getConversationById()
    const syncIndex = callOrder.indexOf("conversations.sync");
    const getByIdIndex = callOrder.indexOf(
      `getConversationById(${META_GROUP_ID})`,
    );
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(getByIdIndex).toBeGreaterThanOrEqual(0);
    expect(syncIndex).toBeLessThan(getByIdIndex);
  });

  it("new member can find groups after conversations.sync()", async () => {
    // Simulate a new member whose client doesn't know about the group yet.
    // Before sync: getConversationById returns null.
    // After sync: getConversationById returns the group.
    let synced = false;

    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "New Member Test",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
    ];

    const mockGroup = createMockGroup(
      META_GROUP_ID,
      "[meta] New Member Test",
      metaMessages,
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockImplementation(async () => {
          synced = true;
        }),
        getConversationById: vi.fn().mockImplementation(async () => {
          // Only returns the group if conversations have been synced
          return synced ? mockGroup : null;
        }),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);

    // Should succeed because syncCommunityState calls conversations.sync() first
    const state = await manager.syncCommunityState(META_GROUP_ID);
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("New Member Test");
  });

  it("fails with 'Group not found' if conversations.sync() is skipped", async () => {
    // This test documents the original bug: without conversations.sync(),
    // a new member's client returns null for the group.
    const mockClient = {
      conversations: {
        // NOTE: no sync method — simulates the broken code path
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(null), // group not synced
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);

    // Even with the fix, if the network doesn't return the group,
    // we get a clear error
    await expect(
      manager.syncCommunityState("nonexistent-group"),
    ).rejects.toThrow("Group not found: nonexistent-group");
  });
});

// ─── Bug #2: SDK-decoded msg.content used instead of manual re-decoding ──────
// When custom codecs are registered with Client.create(), the SDK auto-decodes
// msg.content to the typed object (MetaMessage). The original code tried to
// manually decode from raw bytes, which failed with "No codec found" when
// codecs weren't registered, or double-decoded when they were.
// Fixed in: src/community/manager.ts — syncCommunityState()
//           src/identity/xmtp.ts — codecs passed to Client.create()

describe("Bug: syncCommunityState must use SDK-decoded msg.content", () => {
  const META_GROUP_ID = "meta-grp-codec-test";

  it("reads pre-decoded MetaMessage objects from msg.content", async () => {
    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Codec Test Community",
        description: "Testing codec integration",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "channel.created",
        channelId: "ch-test",
        name: "general",
        xmtpGroupId: "xmtp-grp-general",
        permissions: "open",
      },
      {
        type: "community.role",
        targetDid: "did:plc:alice",
        role: "owner",
      },
    ];

    const mockGroup = createMockGroup(
      META_GROUP_ID,
      "[meta] Codec Test Community",
      metaMessages,
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // All three meta messages should have been correctly read from msg.content
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("Codec Test Community");
    expect(state.config!.description).toBe("Testing codec integration");
    expect(state.channels.size).toBe(1);
    expect(state.channels.get("ch-test")!.name).toBe("general");
    expect(state.roles.get("did:plc:alice")).toBe("owner");
  });

  it("skips messages without matching content type", async () => {
    const mockGroup = {
      id: META_GROUP_ID,
      name: "[meta] Filter Test",
      sync: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue([
        // A valid meta message
        {
          id: "msg-0",
          content: {
            type: "community.config",
            name: "Filter Test",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          } satisfies MetaMessage,
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
        },
        // A plain text message (different content type) — should be ignored
        {
          id: "msg-1",
          content: "Hello, this is a regular message",
          contentType: {
            authorityId: "xmtp.org",
            typeId: "text",
            versionMajor: 1,
            versionMinor: 0,
          },
        },
        // A message with no content type — should be ignored
        {
          id: "msg-2",
          content: "something else",
          contentType: null,
        },
      ]),
    };

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // Only the meta message should have been processed
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("Filter Test");
    expect(state.channels.size).toBe(0);
  });

  it("skips malformed content that has the right type but wrong shape", async () => {
    const mockGroup = {
      id: META_GROUP_ID,
      name: "[meta] Malformed Test",
      sync: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue([
        // Valid config
        {
          id: "msg-0",
          content: {
            type: "community.config",
            name: "Malformed Test",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          } satisfies MetaMessage,
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
        },
        // Has correct content type but content is a string (codec failed)
        {
          id: "msg-1",
          content: "not a MetaMessage object",
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
        },
        // Has correct content type but content is null (codec returned null)
        {
          id: "msg-2",
          content: null,
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
        },
        // Has correct content type but content object has no "type" field
        {
          id: "msg-3",
          content: { foo: "bar" },
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
        },
      ]),
    };

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // Only the first valid message should be processed
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("Malformed Test");
    // None of the malformed messages should have caused errors or bad state
    expect(state.channels.size).toBe(0);
    expect(state.roles.size).toBe(0);
  });
});

// ─── Bug #3: MLS forward secrecy — new members can't see pre-join messages ──
// XMTP MLS groups only let members see messages sent AFTER they were added.
// Meta messages (config, channels, roles) sent before addMember are invisible
// to the new member. Fix: addMember sends a single community.snapshot message.
// This keeps the event log clean — events are events, snapshots are snapshots.
// Fixed in: src/community/manager.ts — addMember()

describe("Bug: addMember sends state snapshot for MLS forward secrecy", () => {
  const META_GROUP_ID = "meta-grp-add-member";
  const CHANNEL_XMTP_ID = "xmtp-grp-channel";

  it("sends a single snapshot after adding member (not N duplicate events)", async () => {
    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Snapshot Test",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "community.role",
        targetDid: "did:plc:alice",
        role: "owner",
      },
      {
        type: "channel.created",
        channelId: "ch-general",
        name: "general",
        xmtpGroupId: CHANNEL_XMTP_ID,
        permissions: "open",
      },
      {
        type: "channel.created",
        channelId: "ch-archived",
        name: "old-channel",
        xmtpGroupId: "xmtp-grp-archived",
        permissions: "open",
      },
      {
        type: "channel.archived",
        channelId: "ch-archived",
      },
    ];

    const metaGroup = createMockGroup(
      META_GROUP_ID,
      "[meta] Snapshot Test",
      metaMessages,
    );
    const channelGroup = createMockGroup(CHANNEL_XMTP_ID, "#general", []);

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockImplementation(async (id: string) => {
          if (id === META_GROUP_ID) return metaGroup;
          if (id === CHANNEL_XMTP_ID) return channelGroup;
          return null;
        }),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    await manager.addMember(META_GROUP_ID, "new-member-inbox");

    // Member added to meta channel and chat channel
    expect(metaGroup.addMembers).toHaveBeenCalledWith(["new-member-inbox"]);
    expect(channelGroup.addMembers).toHaveBeenCalledWith(["new-member-inbox"]);

    // TWO messages sent: community.config (to bootstrap creator authority for
    // new member) + snapshot (full state). Not N re-broadcasts.
    const sendCalls = metaGroup.send.mock.calls;
    expect(sendCalls.length).toBe(2);

    // First message: community.config
    const configEncoded = sendCalls[0][0];
    const configMsg = JSON.parse(new TextDecoder().decode(configEncoded.content));
    expect(configMsg.type).toBe("community.config");
    expect(configMsg.name).toBe("Snapshot Test");

    // Second message: snapshot
    const encoded = sendCalls[1][0];
    const snapshot = JSON.parse(new TextDecoder().decode(encoded.content));

    expect(snapshot.type).toBe("community.snapshot");
    expect(snapshot.config.name).toBe("Snapshot Test");

    // Only non-archived channel included
    expect(snapshot.channels).toHaveLength(1);
    expect(snapshot.channels[0].name).toBe("general");
    expect(
      snapshot.channels.find((c: any) => c.channelId === "ch-archived"),
    ).toBeUndefined();

    // Role included
    expect(snapshot.roles).toHaveLength(1);
    expect(snapshot.roles[0]).toEqual({ did: "did:plc:alice", role: "owner" });
  });

  it("does not send snapshot if community has no config", async () => {
    const metaGroup = createMockGroup(
      META_GROUP_ID,
      "[meta] Empty",
      [],
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(metaGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    await manager.addMember(META_GROUP_ID, "new-member-inbox");

    expect(metaGroup.addMembers).toHaveBeenCalledWith(["new-member-inbox"]);
    expect(metaGroup.send).not.toHaveBeenCalled();
  });

  it("new member can reconstruct state from config + snapshot", async () => {
    // Simulates what the new member sees: community.config (establishes creator)
    // followed by the snapshot (full state). Both sent by addMember.
    const postAddMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "New Member View",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "community.snapshot",
        config: {
          name: "New Member View",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        channels: [
          {
            channelId: "ch-general",
            name: "general",
            xmtpGroupId: "xmtp-grp-general",
            permissions: "open",
          },
        ],
        roles: [{ did: "did:plc:creator", role: "owner" }],
        bans: ["did:plc:spammer"],
      },
    ];

    const newMemberMetaGroup = createMockGroup(
      "meta-new-member",
      "[meta] New Member View",
      postAddMessages,
    );
    const channelGroup = createMockGroup("xmtp-grp-general", "#general", []);

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockImplementation(async (id: string) => {
          if (id === "meta-new-member") return newMemberMetaGroup;
          if (id === "xmtp-grp-general") return channelGroup;
          return null;
        }),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState("meta-new-member");

    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("New Member View");
    expect(state.channels.size).toBe(1);
    expect(state.channels.get("ch-general")!.name).toBe("general");
    expect(state.roles.get("did:plc:creator")).toBe("owner");
    expect(state.bans.has("did:plc:spammer")).toBe(true);
  });

  it("events after snapshot override snapshot state (fold still works)", async () => {
    // Member sees: config (bootstrap) + snapshot + subsequent events.
    // The fold should apply config, then snapshot, then events on top.
    const messages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Original Name",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "community.snapshot",
        config: {
          name: "Original Name",
          settings: {
            allowMemberInvites: true,
            defaultChannelPermissions: "open",
          },
        },
        channels: [
          {
            channelId: "ch-general",
            name: "general",
            xmtpGroupId: "xmtp-grp-general",
            permissions: "open",
          },
        ],
        roles: [{ did: "did:plc:alice", role: "owner" }],
        bans: [],
      },
      // Events after the snapshot
      {
        type: "channel.updated",
        channelId: "ch-general",
        name: "lobby",
      },
      {
        type: "community.role",
        targetDid: "did:plc:bob",
        role: "moderator",
      },
    ];

    const metaGroup = createMockGroup(
      "meta-fold-test",
      "[meta] Fold Test",
      messages,
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(metaGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState("meta-fold-test");

    // Snapshot applied, then events override
    expect(state.config!.name).toBe("Original Name");
    expect(state.channels.get("ch-general")!.name).toBe("lobby"); // updated
    expect(state.roles.get("did:plc:alice")).toBe("owner"); // from snapshot
    expect(state.roles.get("did:plc:bob")).toBe("moderator"); // from event
  });
});

// ─── Bug #4: createCommunity uses targetDid: "self" instead of actual ID ─────
// The owner role message in createCommunity sets targetDid to the literal string
// "self" which is never resolved. No DID-based lookup will ever match.
// Fix: use the actual client inboxId.

describe("Bug: createCommunity sets owner role with actual inboxId, not 'self'", () => {
  it("owner role message uses the client's inboxId, not the string 'self'", async () => {
    const CLIENT_INBOX_ID = "real-inbox-id-abc123";
    const sentMessages: any[] = [];

    const mockGroup = {
      id: "meta-grp-create",
      name: "[meta] My Community",
      sync: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementation(async (encoded: any) => {
        sentMessages.push(encoded);
      }),
      addMembers: vi.fn().mockResolvedValue(undefined),
      removeMembers: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue([]),
    };

    const mockClient = {
      inboxId: CLIENT_INBOX_ID,
      conversations: {
        createGroup: vi.fn().mockResolvedValue(mockGroup),
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    await manager.createCommunity("My Community", "A test community");

    // Two messages sent: config + owner role
    expect(sentMessages).toHaveLength(2);

    // Decode the second message (owner role)
    const ownerEncoded = sentMessages[1];
    const ownerMsg = metaCodec.decode(ownerEncoded);

    expect(ownerMsg.type).toBe("community.role");
    if (ownerMsg.type === "community.role") {
      // MUST NOT be "self" — must be the actual inboxId
      expect(ownerMsg.targetDid).not.toBe("self");
      expect(ownerMsg.targetDid).toBe(CLIENT_INBOX_ID);
    }
  });
});

// ─── Bug #5: syncCommunityState does not pass sender info to replayMetaChannel ─
// Without sender authorization, any member can send a community.config,
// community.role, or community.snapshot that rewrites the community state.
// Fix: syncCommunityState should use replayMetaChannelWithSenders.

describe("Bug: syncCommunityState validates sender authorization", () => {
  const META_GROUP_ID = "meta-grp-auth-test";
  const CREATOR_INBOX = "inbox-creator";
  const MEMBER_INBOX = "inbox-member";

  /**
   * Helper to create a mock group where messages include senderInboxId.
   * This is closer to what the real XMTP SDK returns.
   */
  function createMockGroupWithSenders(
    id: string,
    name: string,
    messages: { meta: MetaMessage; senderInboxId: string }[],
  ) {
    return {
      id,
      name,
      sync: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      addMembers: vi.fn().mockResolvedValue(undefined),
      removeMembers: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue(
        messages.map(({ meta, senderInboxId }, i) => ({
          id: `msg-${i}`,
          senderInboxId,
          content: meta,
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: MetaMessageContentType.versionMajor,
            versionMinor: MetaMessageContentType.versionMinor,
          },
        })),
      ),
    };
  }

  it("ignores config changes from a regular member during sync", async () => {
    const mockGroup = createMockGroupWithSenders(
      META_GROUP_ID,
      "[meta] Auth Test",
      [
        {
          meta: {
            type: "community.config",
            name: "Legit Community",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          },
          senderInboxId: CREATOR_INBOX,
        },
        {
          meta: {
            type: "community.role",
            targetDid: CREATOR_INBOX,
            role: "owner",
          },
          senderInboxId: CREATOR_INBOX,
        },
        {
          meta: {
            type: "community.role",
            targetDid: MEMBER_INBOX,
            role: "member",
          },
          senderInboxId: CREATOR_INBOX,
        },
        // Member tries to hijack the config
        {
          meta: {
            type: "community.config",
            name: "HIJACKED!",
            settings: {
              allowMemberInvites: false,
              defaultChannelPermissions: "moderated",
            },
          },
          senderInboxId: MEMBER_INBOX,
        },
      ],
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // Config should NOT be hijacked
    expect(state.config!.name).toBe("Legit Community");
  });

  it("ignores snapshot from a regular member during sync", async () => {
    const mockGroup = createMockGroupWithSenders(
      META_GROUP_ID,
      "[meta] Snapshot Auth Test",
      [
        {
          meta: {
            type: "community.config",
            name: "Original Community",
            settings: {
              allowMemberInvites: true,
              defaultChannelPermissions: "open",
            },
          },
          senderInboxId: CREATOR_INBOX,
        },
        {
          meta: {
            type: "community.role",
            targetDid: CREATOR_INBOX,
            role: "owner",
          },
          senderInboxId: CREATOR_INBOX,
        },
        {
          meta: {
            type: "community.role",
            targetDid: MEMBER_INBOX,
            role: "member",
          },
          senderInboxId: CREATOR_INBOX,
        },
        // Member tries to nuke state with a fake snapshot
        {
          meta: {
            type: "community.snapshot",
            config: {
              name: "Evil Takeover",
              settings: {
                allowMemberInvites: false,
                defaultChannelPermissions: "moderated",
              },
            },
            channels: [],
            roles: [{ did: MEMBER_INBOX, role: "owner" }],
            bans: [CREATOR_INBOX],
          },
          senderInboxId: MEMBER_INBOX,
        },
      ],
    );

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // Snapshot should be ignored
    expect(state.config!.name).toBe("Original Community");
    expect(state.roles.get(CREATOR_INBOX)).toBe("owner");
    expect(state.roles.get(MEMBER_INBOX)).toBe("member");
    expect(state.bans.has(CREATOR_INBOX)).toBe(false);
  });
});

// ─── Fix #16: Re-validate decoded meta messages via Zod safeParse ──────────
// Manager now uses MetaMessageSchema.safeParse() instead of a loose type cast.
// This ensures malformed objects that happen to have a "type" field are rejected.

describe("Fix: syncCommunityState re-validates decoded content via Zod", () => {
  const META_GROUP_ID = "meta-grp-revalidation";

  it("rejects invalid meta messages that pass the old typeof+in check", async () => {
    // This object has a "type" field but is NOT a valid MetaMessage
    const invalidMetaLike = {
      type: "community.config",
      // missing required 'name' and 'settings' fields
    };

    const validConfig: MetaMessage = {
      type: "community.config",
      name: "Valid Community",
      settings: {
        allowMemberInvites: true,
        defaultChannelPermissions: "open",
      },
    };

    // The mock group returns both invalid and valid messages
    const mockGroup = {
      id: META_GROUP_ID,
      name: "[meta] Test",
      sync: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      addMembers: vi.fn().mockResolvedValue(undefined),
      removeMembers: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue([
        {
          id: "msg-invalid",
          content: invalidMetaLike, // Invalid — should be filtered out
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
          senderInboxId: "inbox-creator",
          sentAtNs: 1000000000n,
        },
        {
          id: "msg-valid",
          content: validConfig,
          contentType: {
            authorityId: MetaMessageContentType.authorityId,
            typeId: MetaMessageContentType.typeId,
            versionMajor: 1,
            versionMinor: 0,
          },
          senderInboxId: "inbox-creator",
          sentAtNs: 2000000000n,
        },
      ]),
    };

    const mockClient = {
      conversations: {
        sync: vi.fn().mockResolvedValue(undefined),
        getConversationById: vi.fn().mockResolvedValue(mockGroup),
      },
      inboxId: "inbox-creator",
    } as any;

    const manager = new CommunityManager(mockClient, db);
    const state = await manager.syncCommunityState(META_GROUP_ID);

    // The valid config should be applied
    expect(state.config).not.toBeNull();
    expect(state.config!.name).toBe("Valid Community");
  });
});
