import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/storage/db.js";
import {
  replayMetaChannelWithSenders,
} from "../src/community/state.js";
import type { MetaMessage } from "../src/community/meta-types.js";
import type { SenderTaggedMessage } from "../src/community/state.js";

/** Test helper: wrap a MetaMessage with a sender inboxId for authorization. */
function tagged(msg: MetaMessage, sender = "test-creator"): SenderTaggedMessage {
  return { message: msg, senderInboxId: sender };
}
import { MetaMessageCodec } from "../src/community/meta-codec.js";
import { MaverickMessageCodec } from "../src/messaging/codec.js";
import type { MaverickMessage } from "../src/messaging/types.js";
import {
  insertMessage,
  insertParents,
  getChannelMessages,
} from "../src/storage/messages.js";
import {
  upsertCommunity,
  upsertChannel,
  upsertRole,
  getCommunity,
  getChannels,
  getRole,
} from "../src/storage/community-cache.js";
import {
  getVisibleMessages,
  getThreadContext,
} from "../src/messaging/dag.js";
import {
  createInvite,
  verifyInvite,
  encodeInvite,
  decodeInvite,
} from "../src/community/invites.js";
import type Database from "better-sqlite3";

const TEST_DIR = join(tmpdir(), "maverick-integration-" + Date.now());
let db: Database.Database;

const metaCodec = new MetaMessageCodec();
const msgCodec = new MaverickMessageCodec();

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  db = createDatabase(join(TEST_DIR, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("full community lifecycle (mock)", () => {
  const COMMUNITY_ID = "meta-grp-001";
  const CHANNEL_GENERAL_ID = "ch-general";
  const CHANNEL_DEV_ID = "ch-dev";
  const XMTP_GRP_GENERAL = "xmtp-grp-general";
  const XMTP_GRP_DEV = "xmtp-grp-dev";

  const ALICE_DID = "did:plc:alice123";
  const BOB_DID = "did:plc:bob456";
  const ALICE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  it("creates community, channels, assigns roles, and replays state", () => {
    // Simulate the sequence of meta messages that would be sent
    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Test Community",
        description: "Integration test community",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "community.role",
        targetDid: ALICE_DID,
        role: "owner",
      },
      {
        type: "channel.created",
        channelId: CHANNEL_GENERAL_ID,
        name: "general",
        description: "General discussion",
        xmtpGroupId: XMTP_GRP_GENERAL,
        permissions: "open",
      },
      {
        type: "channel.created",
        channelId: CHANNEL_DEV_ID,
        name: "dev",
        description: "Development",
        xmtpGroupId: XMTP_GRP_DEV,
        permissions: "moderated",
        category: "engineering",
      },
      {
        type: "community.role",
        targetDid: BOB_DID,
        role: "member",
      },
    ];

    // Each meta message should round-trip through the codec
    for (const msg of metaMessages) {
      const encoded = metaCodec.encode(msg);
      const decoded = metaCodec.decode(encoded);
      expect(decoded).toEqual(msg);
    }

    // Replay to build state (all messages from a single creator sender)
    const CREATOR = "inbox-alice";
    const state = replayMetaChannelWithSenders(
      metaMessages.map((m) => tagged(m, CREATOR)),
    );

    expect(state.config!.name).toBe("Test Community");
    expect(state.channels.size).toBe(2);
    expect(state.roles.get(ALICE_DID)).toBe("owner");
    expect(state.roles.get(BOB_DID)).toBe("member");

    // Persist to local cache
    upsertCommunity(db, {
      id: COMMUNITY_ID,
      name: state.config!.name,
      description: state.config!.description,
      configJson: JSON.stringify(state.config),
    });

    for (const [, ch] of state.channels) {
      upsertChannel(db, {
        id: ch.channelId,
        communityId: COMMUNITY_ID,
        xmtpGroupId: ch.xmtpGroupId,
        name: ch.name,
        description: ch.description,
        category: ch.category,
        permissions: ch.permissions,
      });
    }

    for (const [did, role] of state.roles) {
      upsertRole(db, COMMUNITY_ID, did, role);
    }

    // Verify cache
    const cached = getCommunity(db, COMMUNITY_ID);
    expect(cached!.name).toBe("Test Community");

    const channels = getChannels(db, COMMUNITY_ID);
    expect(channels).toHaveLength(2);
    expect(channels.map((c) => c.name).sort()).toEqual(["dev", "general"]);

    expect(getRole(db, COMMUNITY_ID, ALICE_DID)).toBe("owner");
    expect(getRole(db, COMMUNITY_ID, BOB_DID)).toBe("member");
  });

  it("simulates a multi-user chat session with threading", () => {
    // Set up community + channel in DB
    upsertCommunity(db, { id: COMMUNITY_ID, name: "Test" });
    upsertChannel(db, {
      id: CHANNEL_GENERAL_ID,
      communityId: COMMUNITY_ID,
      xmtpGroupId: XMTP_GRP_GENERAL,
      name: "general",
    });

    // Simulate messages going through codec round-trip, then stored in DB
    const messages: { msg: MaverickMessage; sender: string; id: string; time: number }[] = [
      {
        id: "msg-001",
        sender: "inbox-alice",
        time: 1000,
        msg: { text: "Hey everyone! Welcome to the community.", replyTo: [] },
      },
      {
        id: "msg-002",
        sender: "inbox-bob",
        time: 2000,
        msg: { text: "Thanks Alice! Excited to be here.", replyTo: ["msg-001"] },
      },
      {
        id: "msg-003",
        sender: "inbox-carol",
        time: 3000,
        msg: { text: "Same here!", replyTo: ["msg-001"] },
      },
      {
        id: "msg-004",
        sender: "inbox-alice",
        time: 4000,
        msg: {
          text: "Glad to have you both!",
          replyTo: ["msg-002", "msg-003"], // Multi-parent reply
          quotes: [
            { parentMessageId: "msg-002", quotedText: "Thanks Alice!" },
            { parentMessageId: "msg-003", quotedText: "Same here!" },
          ],
        },
      },
      {
        id: "msg-005",
        sender: "inbox-bob",
        time: 5000,
        msg: { text: "What's the first thing we should work on?", replyTo: [] },
      },
    ];

    // Round-trip each through codec, then store
    for (const { msg, sender, id, time } of messages) {
      const encoded = msgCodec.encode(msg);
      const decoded = msgCodec.decode(encoded);
      expect(decoded.text).toBe(msg.text);
      expect(decoded.replyTo).toEqual(msg.replyTo);

      insertMessage(db, {
        id,
        channelId: CHANNEL_GENERAL_ID,
        senderInboxId: sender,
        text: msg.text,
        createdAt: time,
      });

      if (msg.replyTo.length > 0) {
        insertParents(db, id, msg.replyTo);
      }
    }

    // Get visible messages
    const visible = getVisibleMessages(db, CHANNEL_GENERAL_ID);
    expect(visible).toHaveLength(5);
    expect(visible[0].text).toBe("Hey everyone! Welcome to the community.");
    expect(visible[3].parentIds).toEqual(
      expect.arrayContaining(["msg-002", "msg-003"]),
    );

    // Get thread context for the multi-parent reply
    const ctx = getThreadContext(db, "msg-004")!;
    expect(ctx.message.id).toBe("msg-004");
    expect(ctx.ancestors).toHaveLength(3); // msg-001, msg-002, msg-003
    expect(ctx.ancestors.map((a) => a.id).sort()).toEqual([
      "msg-001",
      "msg-002",
      "msg-003",
    ]);
    expect(ctx.descendants).toHaveLength(0);

    // Get thread context for root message
    const rootCtx = getThreadContext(db, "msg-001")!;
    expect(rootCtx.ancestors).toHaveLength(0);
    expect(rootCtx.descendants).toHaveLength(3); // msg-002, msg-003, msg-004
  });

  it("simulates edit and delete operations", () => {
    upsertCommunity(db, { id: COMMUNITY_ID, name: "Test" });
    upsertChannel(db, {
      id: CHANNEL_GENERAL_ID,
      communityId: COMMUNITY_ID,
      xmtpGroupId: XMTP_GRP_GENERAL,
      name: "general",
    });

    // Alice sends a message
    insertMessage(db, {
      id: "msg-010",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "inbox-alice",
      text: "This has a typo",
      createdAt: 10000,
    });

    // Alice edits it
    const editMsg: MaverickMessage = {
      text: "This is corrected",
      replyTo: [],
      editOf: "msg-010",
    };
    const editEncoded = msgCodec.encode(editMsg);
    const editDecoded = msgCodec.decode(editEncoded);
    expect(editDecoded.editOf).toBe("msg-010");

    insertMessage(db, {
      id: "msg-011",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "inbox-alice",
      text: "This is corrected",
      editOf: "msg-010",
      createdAt: 11000,
    });

    // Bob sends a message
    insertMessage(db, {
      id: "msg-012",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "inbox-bob",
      text: "Oops wrong channel",
      createdAt: 12000,
    });

    // Bob deletes it
    const deleteMsg: MaverickMessage = {
      text: "",
      replyTo: [],
      deleteOf: "msg-012",
    };
    const deleteEncoded = msgCodec.encode(deleteMsg);
    expect(msgCodec.fallback(deleteMsg)).toBe("[Message deleted]");

    insertMessage(db, {
      id: "msg-013",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "inbox-bob",
      text: "",
      deleteOf: "msg-012",
      createdAt: 13000,
    });

    // Carol sends a normal message
    insertMessage(db, {
      id: "msg-014",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "inbox-carol",
      text: "Hello!",
      createdAt: 14000,
    });

    // Visible messages should show edited text, hide deleted, hide control msgs
    const visible = getVisibleMessages(db, CHANNEL_GENERAL_ID);
    expect(visible).toHaveLength(2);
    expect(visible[0].id).toBe("msg-010");
    expect(visible[0].text).toBe("This is corrected");
    expect(visible[0].edited).toBe(true);
    expect(visible[1].id).toBe("msg-014");
    expect(visible[1].text).toBe("Hello!");
  });

  it("full invite flow: create, encode, decode, verify", async () => {
    const invite = await createInvite(
      ALICE_KEY,
      "Test Community",
      COMMUNITY_ID,
      ALICE_DID,
      "member",
      48,
    );

    // Encode to shareable string
    const token = encodeInvite(invite);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(50);

    // Simulate Bob receiving and decoding the token
    const decoded = decodeInvite(token);
    expect(decoded.communityName).toBe("Test Community");
    expect(decoded.metaChannelGroupId).toBe(COMMUNITY_ID);
    expect(decoded.inviterDid).toBe(ALICE_DID);
    expect(decoded.role).toBe("member");
    expect(decoded.inviterAddress).toBeTruthy();

    // Verify the signature using only the public info in the token
    expect(await verifyInvite(decoded)).toBe(true);

    // Tampering should fail
    const tampered = { ...decoded, communityName: "Hacked" };
    expect(await verifyInvite(tampered)).toBe(false);
  });

  it("handles channel lifecycle: create, update, archive", () => {
    const CREATOR = "inbox-lifecycle";
    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Lifecycle Test",
        settings: {
          allowMemberInvites: true,
          defaultChannelPermissions: "open",
        },
      },
      {
        type: "channel.created",
        channelId: "ch-temp",
        name: "temporary",
        xmtpGroupId: "xg-temp",
        permissions: "open",
        description: "Will be modified",
      },
      {
        type: "channel.updated",
        channelId: "ch-temp",
        name: "not-so-temporary",
        description: "Actually useful",
        permissions: "moderated",
      },
    ];

    let state = replayMetaChannelWithSenders(
      metaMessages.map((m) => tagged(m, CREATOR)),
    );
    const ch = state.channels.get("ch-temp")!;
    expect(ch.name).toBe("not-so-temporary");
    expect(ch.description).toBe("Actually useful");
    expect(ch.permissions).toBe("moderated");
    expect(ch.archived).toBe(false);

    // Archive it
    metaMessages.push({
      type: "channel.archived",
      channelId: "ch-temp",
      reason: "No longer needed",
    });

    state = replayMetaChannelWithSenders(
      metaMessages.map((m) => tagged(m, CREATOR)),
    );
    expect(state.channels.get("ch-temp")!.archived).toBe(true);
  });

  it("handles moderation: ban, unban, re-ban", () => {
    const CREATOR = "inbox-mod-test";
    const metaMessages: MetaMessage[] = [
      {
        type: "community.config",
        name: "Mod Test",
        settings: { allowMemberInvites: false, defaultChannelPermissions: "open" },
      },
      { type: "moderation.action", action: "ban", targetDid: "did:plc:spammer", reason: "spam" },
      { type: "moderation.action", action: "ban", targetDid: "did:plc:troll" },
      { type: "moderation.action", action: "unban", targetDid: "did:plc:spammer" },
      { type: "moderation.action", action: "ban", targetDid: "did:plc:spammer", reason: "more spam" },
    ];

    const state = replayMetaChannelWithSenders(
      metaMessages.map((m) => tagged(m, CREATOR)),
    );
    expect(state.bans.has("did:plc:spammer")).toBe(true); // re-banned
    expect(state.bans.has("did:plc:troll")).toBe(true);
    expect(state.bans.size).toBe(2);
  });

  it("simulates concurrent channel messages across multiple channels", () => {
    upsertCommunity(db, { id: COMMUNITY_ID, name: "Test" });
    upsertChannel(db, {
      id: CHANNEL_GENERAL_ID,
      communityId: COMMUNITY_ID,
      xmtpGroupId: XMTP_GRP_GENERAL,
      name: "general",
    });
    upsertChannel(db, {
      id: CHANNEL_DEV_ID,
      communityId: COMMUNITY_ID,
      xmtpGroupId: XMTP_GRP_DEV,
      name: "dev",
    });

    // Messages in #general
    insertMessage(db, {
      id: "g1",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "alice",
      text: "Hello general",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "g2",
      channelId: CHANNEL_GENERAL_ID,
      senderInboxId: "bob",
      text: "Hi!",
      createdAt: 2000,
    });

    // Messages in #dev
    insertMessage(db, {
      id: "d1",
      channelId: CHANNEL_DEV_ID,
      senderInboxId: "alice",
      text: "PR review needed",
      createdAt: 1500,
    });
    insertMessage(db, {
      id: "d2",
      channelId: CHANNEL_DEV_ID,
      senderInboxId: "carol",
      text: "On it!",
      createdAt: 2500,
    });

    // Each channel only shows its own messages
    const generalMsgs = getVisibleMessages(db, CHANNEL_GENERAL_ID);
    expect(generalMsgs).toHaveLength(2);
    expect(generalMsgs[0].text).toBe("Hello general");

    const devMsgs = getVisibleMessages(db, CHANNEL_DEV_ID);
    expect(devMsgs).toHaveLength(2);
    expect(devMsgs[0].text).toBe("PR review needed");
  });
});
