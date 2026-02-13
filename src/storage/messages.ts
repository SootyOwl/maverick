import type Database from "better-sqlite3";

export interface StoredMessage {
  id: string;
  channel_id: string;
  sender_inbox_id: string;
  sender_did: string | null;
  sender_handle: string | null;
  text: string;
  edit_of: string | null;
  delete_of: string | null;
  created_at: number;
  raw_content: Buffer | null;
}

export interface InsertMessageParams {
  id: string;
  channelId: string;
  senderInboxId: string;
  senderDid?: string;
  senderHandle?: string;
  text: string;
  editOf?: string;
  deleteOf?: string;
  createdAt: number;
  rawContent?: Buffer;
}

export function insertMessage(
  db: Database.Database,
  msg: InsertMessageParams,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages
       (id, channel_id, sender_inbox_id, sender_did, sender_handle, text, edit_of, delete_of, created_at, raw_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.channelId,
    msg.senderInboxId,
    msg.senderDid ?? null,
    msg.senderHandle ?? null,
    msg.text,
    msg.editOf ?? null,
    msg.deleteOf ?? null,
    msg.createdAt,
    msg.rawContent ?? null,
  );
}

export function insertParents(
  db: Database.Database,
  messageId: string,
  parentIds: string[],
): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO message_parents (message_id, parent_id) VALUES (?, ?)`,
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const parentId of ids) {
      stmt.run(messageId, parentId);
    }
  });
  insertMany(parentIds);
}

export function getChannelMessages(
  db: Database.Database,
  channelId: string,
  limit = 100,
  before?: number,
): StoredMessage[] {
  if (before !== undefined) {
    return db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM messages
          WHERE channel_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        ) ORDER BY created_at ASC`,
      )
      .all(channelId, before, limit) as StoredMessage[];
  }
  return db
    .prepare(
      `SELECT * FROM (
        SELECT * FROM messages
        WHERE channel_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC`,
    )
    .all(channelId, limit) as StoredMessage[];
}

export function getMessageChildren(
  db: Database.Database,
  messageId: string,
): StoredMessage[] {
  return db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN message_parents mp ON mp.message_id = m.id
       WHERE mp.parent_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(messageId) as StoredMessage[];
}

export function getMessageParents(
  db: Database.Database,
  messageId: string,
): StoredMessage[] {
  return db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN message_parents mp ON mp.parent_id = m.id
       WHERE mp.message_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(messageId) as StoredMessage[];
}

const MAX_GRAPH_NODES = 1000;

export function getThreadGraph(
  db: Database.Database,
  messageId: string,
): StoredMessage[] {
  // BFS traversal to collect all connected messages (ancestors + descendants)
  // Bounded to MAX_GRAPH_NODES to prevent DoS from pathological thread shapes.
  const visited = new Set<string>();
  const queue: string[] = [messageId];
  const result: StoredMessage[] = [];

  while (queue.length > 0 && visited.size < MAX_GRAPH_NODES) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const msg = db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(id) as StoredMessage | undefined;
    if (!msg) continue;
    result.push(msg);

    // Get parents
    const parentIds = (
      db
        .prepare(
          `SELECT parent_id FROM message_parents WHERE message_id = ?`,
        )
        .all(id) as { parent_id: string }[]
    ).map((r) => r.parent_id);

    // Get children
    const childIds = (
      db
        .prepare(
          `SELECT message_id FROM message_parents WHERE parent_id = ?`,
        )
        .all(id) as { message_id: string }[]
    ).map((r) => r.message_id);

    for (const linked of [...parentIds, ...childIds]) {
      if (!visited.has(linked)) {
        queue.push(linked);
      }
    }
  }

  result.sort((a, b) => a.created_at - b.created_at);
  return result;
}

export function getParentIds(
  db: Database.Database,
  messageId: string,
): string[] {
  return (
    db
      .prepare(
        `SELECT parent_id FROM message_parents WHERE message_id = ?`,
      )
      .all(messageId) as { parent_id: string }[]
  ).map((r) => r.parent_id);
}
