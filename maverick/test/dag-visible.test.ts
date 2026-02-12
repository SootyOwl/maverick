import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/storage/db.js";
import { insertMessage, insertParents, getChannelMessages } from "../src/storage/messages.js";
import {
  upsertCommunity,
  upsertChannel,
} from "../src/storage/community-cache.js";
import {
  getVisibleMessages,
  getThreadContext,
} from "../src/messaging/dag.js";
import type Database from "better-sqlite3";

const TEST_DIR = join(tmpdir(), "maverick-dag-test-" + Date.now());
let db: Database.Database;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  db = createDatabase(join(TEST_DIR, "test.db"));
  upsertCommunity(db, { id: "community-1", name: "Test" });
  upsertChannel(db, {
    id: "chan-1",
    communityId: "community-1",
    xmtpGroupId: "xg-1",
    name: "general",
  });
});

afterEach(() => {
  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getVisibleMessages", () => {
  it("returns messages ordered by time", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "First",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Second",
      createdAt: 2000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible).toHaveLength(2);
    expect(visible[0].text).toBe("First");
    expect(visible[1].text).toBe("Second");
  });

  it("hides deleted messages", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Will be deleted",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "",
      deleteOf: "m1",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "m3",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Visible",
      createdAt: 3000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible).toHaveLength(1);
    expect(visible[0].text).toBe("Visible");
  });

  it("shows latest edit text", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Original",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Edited once",
      editOf: "m1",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "m3",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Edited twice",
      editOf: "m1",
      createdAt: 3000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible).toHaveLength(1);
    expect(visible[0].text).toBe("Edited twice");
    expect(visible[0].edited).toBe(true);
  });

  it("includes parent IDs for reply messages", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Root",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Reply",
      createdAt: 2000,
    });
    insertParents(db, "m2", ["m1"]);

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible[1].parentIds).toEqual(["m1"]);
  });
});

describe("getThreadContext", () => {
  it("returns null for missing message", () => {
    expect(getThreadContext(db, "nonexistent")).toBeNull();
  });

  it("returns ancestors and descendants", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Root",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Reply",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "m3",
      channelId: "chan-1",
      senderInboxId: "carol",
      text: "Reply to reply",
      createdAt: 3000,
    });
    insertParents(db, "m2", ["m1"]);
    insertParents(db, "m3", ["m2"]);

    const ctx = getThreadContext(db, "m2")!;
    expect(ctx.message.id).toBe("m2");
    expect(ctx.ancestors).toHaveLength(1);
    expect(ctx.ancestors[0].id).toBe("m1");
    expect(ctx.descendants).toHaveLength(1);
    expect(ctx.descendants[0].id).toBe("m3");
  });

  it("handles multi-parent ancestors", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "a",
      text: "A",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "b",
      text: "B",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "m3",
      channelId: "chan-1",
      senderInboxId: "c",
      text: "C",
      createdAt: 3000,
    });
    insertParents(db, "m3", ["m1", "m2"]);

    const ctx = getThreadContext(db, "m3")!;
    expect(ctx.ancestors).toHaveLength(2);
    expect(ctx.ancestors.map((a) => a.id).sort()).toEqual(["m1", "m2"]);
  });
});

describe("getChannelMessages returns newest messages", () => {
  it("returns newest N messages when channel has more than limit", () => {
    // Insert 20 messages with sequential timestamps
    for (let i = 1; i <= 20; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    // Request only 5 messages — should get the 5 NEWEST (msg-16 through msg-20)
    const messages = getChannelMessages(db, "chan-1", 5);
    expect(messages).toHaveLength(5);

    // Should be the newest 5 messages
    expect(messages[0].id).toBe("msg-16");
    expect(messages[1].id).toBe("msg-17");
    expect(messages[2].id).toBe("msg-18");
    expect(messages[3].id).toBe("msg-19");
    expect(messages[4].id).toBe("msg-20");

    // Should be in ascending chronological order for display
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].created_at).toBeGreaterThan(messages[i - 1].created_at);
    }
  });

  it("supports pagination with 'before' parameter", () => {
    // Insert 20 messages
    for (let i = 1; i <= 20; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    // Get newest 5 (msg-16 to msg-20)
    const page1 = getChannelMessages(db, "chan-1", 5);
    expect(page1).toHaveLength(5);
    expect(page1[0].id).toBe("msg-16");
    expect(page1[4].id).toBe("msg-20");

    // Get the 5 messages before the oldest in page1 (before timestamp 16000)
    const page2 = getChannelMessages(db, "chan-1", 5, page1[0].created_at);
    expect(page2).toHaveLength(5);
    expect(page2[0].id).toBe("msg-11");
    expect(page2[4].id).toBe("msg-15");

    // Results should be in ascending chronological order
    for (let i = 1; i < page2.length; i++) {
      expect(page2[i].created_at).toBeGreaterThan(page2[i - 1].created_at);
    }

    // Continue paginating
    const page3 = getChannelMessages(db, "chan-1", 5, page2[0].created_at);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe("msg-6");
    expect(page3[4].id).toBe("msg-10");
  });

  it("handles before=0 correctly (does not skip pagination branch)", () => {
    // Insert messages with timestamp 0 and positive timestamps
    insertMessage(db, {
      id: "msg-zero",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Epoch message",
      createdAt: 0,
    });
    for (let i = 1; i <= 5; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    // Paginate with before=1000 (should get msg-zero only)
    const page = getChannelMessages(db, "chan-1", 10, 1000);
    expect(page).toHaveLength(1);
    expect(page[0].id).toBe("msg-zero");

    // before=0 should return nothing (no messages before epoch 0)
    const empty = getChannelMessages(db, "chan-1", 10, 0);
    expect(empty).toHaveLength(0);
  });

  it("returns all messages when total is less than limit", () => {
    for (let i = 1; i <= 3; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    const messages = getChannelMessages(db, "chan-1", 10);
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe("msg-1");
    expect(messages[2].id).toBe("msg-3");
  });
});

describe("getVisibleMessages — sender validation on edits/deletes", () => {
  it("ignores delete from a different sender than the original author", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Alice's message",
      createdAt: 1000,
    });
    // Bob tries to delete Alice's message
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "",
      deleteOf: "m1",
      createdAt: 2000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    // Alice's message should still be visible (Bob can't delete it)
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("m1");
    expect(visible[0].text).toBe("Alice's message");
  });

  it("ignores edit from a different sender than the original author", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Alice's original",
      createdAt: 1000,
    });
    // Bob tries to edit Alice's message
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Bob's tampering",
      editOf: "m1",
      createdAt: 2000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    // Alice's message should show original text (Bob can't edit it)
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("m1");
    expect(visible[0].text).toBe("Alice's original");
    expect(visible[0].edited).toBe(false);
  });

  it("allows edit from the same sender", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Original",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Edited",
      editOf: "m1",
      createdAt: 2000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible).toHaveLength(1);
    expect(visible[0].text).toBe("Edited");
    expect(visible[0].edited).toBe(true);
  });

  it("allows delete from the same sender", () => {
    insertMessage(db, {
      id: "m1",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Will delete",
      createdAt: 1000,
    });
    insertMessage(db, {
      id: "m2",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "",
      deleteOf: "m1",
      createdAt: 2000,
    });
    insertMessage(db, {
      id: "m3",
      channelId: "chan-1",
      senderInboxId: "bob",
      text: "Still here",
      createdAt: 3000,
    });

    const visible = getVisibleMessages(db, "chan-1");
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("m3");
  });
});

describe("getVisibleMessages returns newest visible messages", () => {
  it("returns newest visible messages when channel has more than limit", () => {
    // Insert 20 normal messages
    for (let i = 1; i <= 20; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    // Request 5 visible messages — should get the 5 newest
    const visible = getVisibleMessages(db, "chan-1", 5);
    expect(visible).toHaveLength(5);

    // Should be the newest 5 visible messages
    expect(visible[0].id).toBe("msg-16");
    expect(visible[1].id).toBe("msg-17");
    expect(visible[2].id).toBe("msg-18");
    expect(visible[3].id).toBe("msg-19");
    expect(visible[4].id).toBe("msg-20");

    // Should be in ascending chronological order
    for (let i = 1; i < visible.length; i++) {
      expect(visible[i].createdAt).toBeGreaterThan(visible[i - 1].createdAt);
    }
  });

  it("returns newest visible messages excluding edits and deletes", () => {
    // Insert 20 normal messages
    for (let i = 1; i <= 18; i++) {
      insertMessage(db, {
        id: `msg-${i}`,
        channelId: "chan-1",
        senderInboxId: "alice",
        text: `Message ${i}`,
        createdAt: i * 1000,
      });
    }

    // msg-15 gets edited (edit message at timestamp 19000)
    insertMessage(db, {
      id: "edit-15",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "Message 15 (edited)",
      editOf: "msg-15",
      createdAt: 19000,
    });

    // msg-16 gets deleted (delete message at timestamp 20000)
    insertMessage(db, {
      id: "delete-16",
      channelId: "chan-1",
      senderInboxId: "alice",
      text: "",
      deleteOf: "msg-16",
      createdAt: 20000,
    });

    // Requesting 5 visible messages:
    // msg-16 is deleted, so visible are msg-1..msg-15, msg-17, msg-18
    // Newest 5 visible: msg-14, msg-15, msg-17, msg-18 ... need to figure out
    // Total visible: 17 (18 normal - 1 deleted), so newest 5 = msg-14, msg-15(edited), msg-17, msg-18
    // Wait: msg-14, msg-15, msg-17, msg-18 = only 4. Let me count better.
    // Visible messages: msg-1 through msg-18 minus msg-16 = 17 messages
    // Newest 5: msg-14, msg-15, msg-17, msg-18 - that's 4 from the end.
    // Actually: msg-13, msg-14, msg-15, msg-17, msg-18 = 5 newest visible
    const visible = getVisibleMessages(db, "chan-1", 5);
    expect(visible).toHaveLength(5);

    // Newest 5 visible in ascending order:
    expect(visible[0].id).toBe("msg-13");
    expect(visible[1].id).toBe("msg-14");
    expect(visible[2].id).toBe("msg-15");
    expect(visible[2].text).toBe("Message 15 (edited)"); // should show edited text
    expect(visible[2].edited).toBe(true);
    expect(visible[3].id).toBe("msg-17");
    expect(visible[4].id).toBe("msg-18");
  });
});
