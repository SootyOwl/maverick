import type Database from "better-sqlite3";
import {
  getChannelMessages,
  getMessageParents,
  getMessageChildren,
  getParentIds,
  type StoredMessage,
} from "../storage/messages.js";

export interface VisibleMessage {
  id: string;
  channelId: string;
  senderInboxId: string;
  senderDid: string | null;
  senderHandle: string | null;
  text: string;
  createdAt: number;
  parentIds: string[];
  edited: boolean;
  editedText?: string;
}

export interface ThreadContext {
  ancestors: StoredMessage[];
  message: StoredMessage;
  descendants: StoredMessage[];
}

export function getVisibleMessages(
  db: Database.Database,
  channelId: string,
  limit = 100,
): VisibleMessage[] {
  const raw = getChannelMessages(db, channelId, limit * 2); // Fetch extra to handle edits/deletes

  // Index messages by ID for sender verification
  const byId = new Map<string, StoredMessage>();
  for (const msg of raw) {
    byId.set(msg.id, msg);
  }

  // Build maps for edits and deletes, enforcing sender ownership:
  // only the original message's sender can edit or delete it.
  const editMap = new Map<string, StoredMessage>(); // original id → latest edit
  const deletedIds = new Set<string>();

  for (const msg of raw) {
    if (msg.delete_of) {
      const original = byId.get(msg.delete_of);
      // Only allow delete if sender matches the original message sender
      if (original && original.sender_inbox_id === msg.sender_inbox_id) {
        deletedIds.add(msg.delete_of);
      }
    }
    if (msg.edit_of) {
      const original = byId.get(msg.edit_of);
      // Only allow edit if sender matches the original message sender
      if (original && original.sender_inbox_id === msg.sender_inbox_id) {
        const existing = editMap.get(msg.edit_of);
        if (!existing || msg.created_at > existing.created_at) {
          editMap.set(msg.edit_of, msg);
        }
      }
    }
  }

  const visible: VisibleMessage[] = [];

  for (const msg of raw) {
    // Skip deleted messages
    if (deletedIds.has(msg.id)) continue;
    // Skip edit and delete control messages themselves
    if (msg.edit_of || msg.delete_of) continue;

    const parentIds = getParentIds(db, msg.id);
    const edit = editMap.get(msg.id);

    visible.push({
      id: msg.id,
      channelId: msg.channel_id,
      senderInboxId: msg.sender_inbox_id,
      senderDid: msg.sender_did,
      senderHandle: msg.sender_handle,
      text: edit ? edit.text : msg.text,
      createdAt: msg.created_at,
      parentIds,
      edited: !!edit,
      editedText: edit ? edit.text : undefined,
    });
  }

  // Return the newest `limit` visible messages (tail of the array),
  // already in ascending chronological order for display
  if (visible.length > limit) {
    return visible.slice(visible.length - limit);
  }

  return visible;
}

const MAX_THREAD_NODES = 500;

export function getThreadContext(
  db: Database.Database,
  messageId: string,
): ThreadContext | null {
  const msg = db
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(messageId) as StoredMessage | undefined;

  if (!msg) return null;

  // Collect ancestors by walking up parents (bounded)
  const ancestors: StoredMessage[] = [];
  const visited = new Set<string>();
  const queue = [...getParentIds(db, messageId)];

  while (queue.length > 0 && visited.size < MAX_THREAD_NODES) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);

    const parent = db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(parentId) as StoredMessage | undefined;
    if (parent) {
      ancestors.push(parent);
      const grandparents = getParentIds(db, parentId);
      queue.push(...grandparents);
    }
  }
  ancestors.sort((a, b) => a.created_at - b.created_at);

  // Collect descendants by walking down children (bounded)
  const descendants: StoredMessage[] = [];
  const visitedDown = new Set<string>();
  const childQueue = getMessageChildren(db, messageId).map((c) => c.id);

  while (childQueue.length > 0 && visitedDown.size < MAX_THREAD_NODES) {
    const childId = childQueue.shift()!;
    if (visitedDown.has(childId)) continue;
    visitedDown.add(childId);

    const child = db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(childId) as StoredMessage | undefined;
    if (child) {
      descendants.push(child);
      const grandchildren = getMessageChildren(db, childId);
      childQueue.push(...grandchildren.map((c) => c.id));
    }
  }
  descendants.sort((a, b) => a.created_at - b.created_at);

  return { ancestors, message: msg, descendants };
}
