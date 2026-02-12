import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/storage/db.js";
import {
  insertMessage,
  insertParents,
  getChannelMessages,
  getMessageChildren,
  getMessageParents,
  getThreadGraph,
  getParentIds,
} from "../src/storage/messages.js";
import {
  upsertCommunity,
  upsertChannel,
  upsertRole,
  getCommunity,
  getChannels,
  getRole,
  archiveChannel,
} from "../src/storage/community-cache.js";
import type Database from "better-sqlite3";

const TEST_DIR = join(tmpdir(), "maverick-test-" + Date.now());
let db: Database.Database;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  db = createDatabase(join(TEST_DIR, "test.db"));
  // Seed a community and channel for FK constraints
  upsertCommunity(db, { id: "community-1", name: "Test Community" });
  upsertChannel(db, {
    id: "chan-1",
    communityId: "community-1",
    xmtpGroupId: "xmtp-group-1",
    name: "general",
  });
});

afterEach(() => {
  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("database setup", () => {
  it("creates all tables", () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("communities");
    expect(names).toContain("channels");
    expect(names).toContain("messages");
    expect(names).toContain("message_parents");
    expect(names).toContain("roles");
    expect(names).toContain("profiles");
  });
});

describe("message CRUD", () => {
  it("inserts and retrieves messages", () => {
    insertMessage(db, {
      id: "msg-1",
      channelId: "chan-1",
      senderInboxId: "inbox-alice",
      text: "Hello world",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "msg-2",
      channelId: "chan-1",
      senderInboxId: "inbox-bob",
      text: "Hi Alice!",
      createdAt: 2000,
    });

    const messages = getChannelMessages(db, "chan-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("Hello world");
    expect(messages[1].text).toBe("Hi Alice!");
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "inbox-alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }
    const messages = getChannelMessages(db, "chan-1", 5);
    expect(messages).toHaveLength(5);
  });
});

describe("multi-parent threading (DAG)", () => {
  it("inserts parents and retrieves them", () => {
    insertMessage(db, {
      id: "msg-1",
      channelId: "chan-1",
      senderInboxId: "inbox-alice",
      text: "Root message",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "msg-2",
      channelId: "chan-1",
      senderInboxId: "inbox-bob",
      text: "Another root",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "msg-3",
      channelId: "chan-1",
      senderInboxId: "inbox-carol",
      text: "Reply to both",
      createdAt: 3000,
    });

    insertParents(db, "msg-3", ["msg-1", "msg-2"]);

    const parentIds = getParentIds(db, "msg-3");
    expect(parentIds).toHaveLength(2);
    expect(parentIds).toContain("msg-1");
    expect(parentIds).toContain("msg-2");

    const parents = getMessageParents(db, "msg-3");
    expect(parents).toHaveLength(2);
    expect(parents.map((m) => m.id)).toContain("msg-1");
    expect(parents.map((m) => m.id)).toContain("msg-2");
  });

  it("gets children", () => {
    insertMessage(db, {
      id: "msg-1",
      channelId: "chan-1",
      senderInboxId: "inbox-alice",
      text: "Parent",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "msg-2",
      channelId: "chan-1",
      senderInboxId: "inbox-bob",
      text: "Child 1",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "msg-3",
      channelId: "chan-1",
      senderInboxId: "inbox-carol",
      text: "Child 2",
      createdAt: 3000,
    });

    insertParents(db, "msg-2", ["msg-1"]);
    insertParents(db, "msg-3", ["msg-1"]);

    const children = getMessageChildren(db, "msg-1");
    expect(children).toHaveLength(2);
  });

  it("traverses full thread graph", () => {
    // Create a DAG: msg-1 → msg-3, msg-2 → msg-3, msg-3 → msg-4
    insertMessage(db, {
      id: "msg-1",
      channelId: "chan-1",
      senderInboxId: "inbox-a",
      text: "A",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "msg-2",
      channelId: "chan-1",
      senderInboxId: "inbox-b",
      text: "B",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "msg-3",
      channelId: "chan-1",
      senderInboxId: "inbox-c",
      text: "C (multi-parent reply)",
      createdAt: 3000,
    });
    insertMessage(db, {
      id: "msg-4",
      channelId: "chan-1",
      senderInboxId: "inbox-d",
      text: "D (reply to C)",
      createdAt: 4000,
    });

    insertParents(db, "msg-3", ["msg-1", "msg-2"]);
    insertParents(db, "msg-4", ["msg-3"]);

    // Starting from msg-3, should find all 4 messages
    const graph = getThreadGraph(db, "msg-3");
    expect(graph).toHaveLength(4);
    expect(graph.map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ]);

    // Starting from msg-4, should also find all 4
    const graph2 = getThreadGraph(db, "msg-4");
    expect(graph2).toHaveLength(4);
  });
});

describe("community cache", () => {
  it("upserts and gets community", () => {
    upsertCommunity(db, {
      id: "comm-2",
      name: "My Community",
      description: "A test community",
      configJson: JSON.stringify({ foo: "bar" }),
    });
    const comm = getCommunity(db, "comm-2");
    expect(comm).not.toBeNull();
    expect(comm!.name).toBe("My Community");
    expect(comm!.description).toBe("A test community");
  });

  it("returns null for missing community", () => {
    expect(getCommunity(db, "nonexistent")).toBeNull();
  });

  it("lists channels for community", () => {
    const channels = getChannels(db, "community-1");
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("general");
  });

  it("archives a channel", () => {
    archiveChannel(db, "chan-1");
    const channels = getChannels(db, "community-1");
    expect(channels[0].archived).toBe(1);
  });

  it("manages roles", () => {
    upsertRole(db, "community-1", "did:plc:alice", "admin");
    expect(getRole(db, "community-1", "did:plc:alice")).toBe("admin");
    upsertRole(db, "community-1", "did:plc:alice", "owner");
    expect(getRole(db, "community-1", "did:plc:alice")).toBe("owner");
    expect(getRole(db, "community-1", "did:plc:unknown")).toBe("member");
  });
});
